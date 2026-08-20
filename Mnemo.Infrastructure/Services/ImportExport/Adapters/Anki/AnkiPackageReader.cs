using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Packaging;
using ZstdSharp;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters.Anki;

/// <summary>Which of the three Anki package layouts a file turned out to use.</summary>
internal enum AnkiPackageVersion
{
    /// <summary>Oldest layout: a plain <c>collection.anki2</c> beside a JSON media table.</summary>
    Legacy1 = 1,

    /// <summary>Second layout: a plain <c>collection.anki21</c> beside a JSON media table.</summary>
    Legacy2 = 2,

    /// <summary>Current layout: a zstd <c>collection.anki21b</c> beside a zstd protobuf media table.</summary>
    Latest = 3,
}

/// <summary>What one extracted package turned out to hold.</summary>
/// <param name="Version">The layout the package was read as.</param>
/// <param name="CollectionPath">Absolute path of the extracted, decompressed collection database.</param>
/// <param name="MediaNamesByStoredName">
/// Name inside the package to the original filename a card's HTML refers to.
/// </param>
/// <param name="Warnings">Anything skipped or guessed at, for the import result to surface.</param>
internal sealed record AnkiPackageContents(
    AnkiPackageVersion Version,
    string CollectionPath,
    IReadOnlyDictionary<string, string> MediaNamesByStoredName,
    IReadOnlyList<TransferWarning> Warnings);

/// <summary>
/// Unpacks an <c>.apkg</c> or <c>.colpkg</c> file into a working directory, handling all three
/// layouts Anki has shipped, and reads its media table.
/// </summary>
/// <remarks>
/// Extraction is bounded by the same limits the Mnemo package reader uses and enforced while
/// copying rather than read off the archive header, because both zip and zstd let a small file
/// declare, or simply produce, an enormous one.
/// </remarks>
internal static class AnkiPackageReader
{
    private const string MetaEntryName = "meta";
    private const string MediaTableEntryName = "media";
    private const string ModernCollectionEntryName = "collection.anki21b";
    private const string LegacyCollectionEntryName = "collection.anki21";
    private const string OldestCollectionEntryName = "collection.anki2";

    /// <summary>Largest header Mnemo will read as a package version; the real one is a few bytes.</summary>
    private const int MaxMetaBytes = 4096;

    private const int PackageMetadataVersionField = 1;
    private const int MediaEntriesEntryField = 1;
    private const int MediaEntryNameField = 1;
    private const int MediaEntryLegacyZipNameField = 255;

    public static Task<AnkiPackageContents> ExtractAsync(
        string packagePath,
        string destinationDirectory,
        CancellationToken cancellationToken) =>
        ExtractAsync(packagePath, destinationDirectory, MnemoPackageService.PackageReadLimits.Default, cancellationToken);

    internal static async Task<AnkiPackageContents> ExtractAsync(
        string packagePath,
        string destinationDirectory,
        MnemoPackageService.PackageReadLimits limits,
        CancellationToken cancellationToken)
    {
        var warnings = new List<TransferWarning>();

        using var archive = ZipFile.OpenRead(packagePath);
        var version = await ReadVersionAsync(archive, warnings, cancellationToken).ConfigureAwait(false);
        var collectionEntryName = SelectCollectionEntryName(archive, version)
            ?? throw new InvalidOperationException("Package does not contain an Anki collection database.");

        var entryCount = 0;
        long totalBytes = 0;
        foreach (var entry in archive.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrEmpty(entry.Name))
                continue;
            if (string.Equals(entry.FullName, MetaEntryName, StringComparison.Ordinal))
                continue;

            // A modern package ships a stub collection under an old name so an older Anki opens it
            // and says it is too old. Reading that stub would import an empty collection.
            if (IsCollectionEntryName(entry.FullName) && !string.Equals(entry.FullName, collectionEntryName, StringComparison.Ordinal))
                continue;

            if (++entryCount > limits.MaxEntryCount)
                throw new InvalidDataException($"Package contains more than {limits.MaxEntryCount} entries.");

            // A cheap first gate on the declared size; the copy below enforces the real one, since a
            // forged header is exactly how a bomb slips past a size check that trusts it.
            if (entry.Length > limits.MaxEntryBytes)
                throw new InvalidDataException($"Package entry '{entry.FullName}' exceeds the {limits.MaxEntryBytes / (1024 * 1024)} MB limit.");

            var destinationPath = ResolveDestinationPath(destinationDirectory, entry.FullName, limits);
            var isCollection = string.Equals(entry.FullName, collectionEntryName, StringComparison.Ordinal);
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
                totalBytes += await ExtractEntryAsync(
                    entry, destinationPath, version, limits, limits.MaxTotalBytes - totalBytes, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (!isCollection && ex is IOException or UnauthorizedAccessException or NotSupportedException or ZstdException)
            {
                // One unreadable media file should cost that one picture, not the whole deck. The
                // card that referenced it reports the miss when its src fails to resolve.
                warnings.Add(TransferWarning.Of("AnkiEntryUnpackFailed", ("entryName", entry.FullName), ("error", ex.Message)));
                TryDeleteFile(destinationPath);
            }
        }

        var collectionPath = Path.Combine(destinationDirectory, collectionEntryName);
        if (!File.Exists(collectionPath))
            throw new InvalidOperationException("Package does not contain an Anki collection database.");

        var media = await ReadMediaTableAsync(destinationDirectory, version, warnings, cancellationToken).ConfigureAwait(false);
        return new AnkiPackageContents(version, collectionPath, media, warnings);
    }

    /// <summary>
    /// The layout the package declares in its header, falling back to which collection file it
    /// carries when the header is absent (packages older than the header) or names a layout this
    /// build predates.
    /// </summary>
    private static async Task<AnkiPackageVersion> ReadVersionAsync(
        ZipArchive archive,
        ICollection<TransferWarning> warnings,
        CancellationToken cancellationToken)
    {
        var meta = archive.GetEntry(MetaEntryName);
        if (meta is not null && meta.Length is > 0 and <= MaxMetaBytes)
        {
            var buffer = new byte[meta.Length];
            int read;
            await using (var stream = meta.Open())
                read = await stream.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, cancellationToken).ConfigureAwait(false);

            if (TryReadDeclaredVersion(buffer.AsSpan(0, read), out var declared))
            {
                if (declared is >= 1 and <= 3)
                    return (AnkiPackageVersion)declared;

                warnings.Add(TransferWarning.Of("AnkiNewerFormatVersion", ("declaredVersion", declared.ToString(CultureInfo.InvariantCulture))));
                return AnkiPackageVersion.Latest;
            }
        }

        if (archive.GetEntry(ModernCollectionEntryName) is not null)
            return AnkiPackageVersion.Latest;

        return archive.GetEntry(LegacyCollectionEntryName) is not null
            ? AnkiPackageVersion.Legacy2
            : AnkiPackageVersion.Legacy1;
    }

    private static bool TryReadDeclaredVersion(ReadOnlySpan<byte> meta, out int version)
    {
        version = 0;
        var reader = new AnkiProtobufReader(meta);
        while (reader.TryReadFieldHeader(out var field, out var wireType))
        {
            if (field == PackageMetadataVersionField && wireType == AnkiProtobufReader.WireTypeVarint)
            {
                if (!reader.TryReadVarint(out var value))
                    return false;

                version = value > int.MaxValue ? 0 : (int)value;
                return version > 0;
            }

            if (!reader.TrySkip(wireType))
                return false;
        }

        return false;
    }

    private static string? SelectCollectionEntryName(ZipArchive archive, AnkiPackageVersion version)
    {
        if (version == AnkiPackageVersion.Latest)
            return archive.GetEntry(ModernCollectionEntryName) is not null ? ModernCollectionEntryName : null;

        if (archive.GetEntry(LegacyCollectionEntryName) is not null)
            return LegacyCollectionEntryName;

        return archive.GetEntry(OldestCollectionEntryName) is not null ? OldestCollectionEntryName : null;
    }

    private static bool IsCollectionEntryName(string entryName) =>
        string.Equals(entryName, ModernCollectionEntryName, StringComparison.Ordinal) ||
        string.Equals(entryName, LegacyCollectionEntryName, StringComparison.Ordinal) ||
        string.Equals(entryName, OldestCollectionEntryName, StringComparison.Ordinal);

    private static async Task<long> ExtractEntryAsync(
        ZipArchiveEntry entry,
        string destinationPath,
        AnkiPackageVersion version,
        MnemoPackageService.PackageReadLimits limits,
        long remainingTotal,
        CancellationToken cancellationToken)
    {
        await using var source = entry.Open();
        await using var target = File.Create(destinationPath);

        // The latest layout compresses every payload individually, the header excepted, so the
        // decision is the format's rather than a guess at each entry's bytes.
        if (version != AnkiPackageVersion.Latest)
            return await CopyBoundedAsync(source, target, entry.FullName, limits, remainingTotal, cancellationToken).ConfigureAwait(false);

        await using var decompressed = new DecompressionStream(source);
        return await CopyBoundedAsync(decompressed, target, entry.FullName, limits, remainingTotal, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Copies one entry out, aborting the moment it passes its own cap or the budget the rest of
    /// the package has left. The count rides the copy, so neither a lying zip header nor a zstd
    /// frame that expands a thousandfold can walk past it.
    /// </summary>
    private static async Task<long> CopyBoundedAsync(
        Stream source,
        Stream destination,
        string entryName,
        MnemoPackageService.PackageReadLimits limits,
        long remainingTotal,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[81920];
        long written = 0;
        int read;
        while ((read = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
        {
            written += read;
            if (written > limits.MaxEntryBytes)
                throw new InvalidDataException($"Package entry '{entryName}' exceeds the {limits.MaxEntryBytes / (1024 * 1024)} MB limit.");
            if (written > remainingTotal)
                throw new InvalidDataException($"Package expands beyond the {limits.MaxTotalBytes / (1024 * 1024)} MB total limit.");

            await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }

        return written;
    }

    /// <summary>
    /// Where an entry may be written. Entry names come from the archive, so an absolute path or a
    /// climb out of the working directory is refused rather than followed.
    /// </summary>
    private static string ResolveDestinationPath(string destinationDirectory, string entryName, MnemoPackageService.PackageReadLimits limits)
    {
        var normalized = entryName.Replace('\\', '/');
        if (normalized.StartsWith('/') || normalized.Contains("../", StringComparison.Ordinal) || normalized.EndsWith("/..", StringComparison.Ordinal))
            throw new InvalidDataException($"Unsafe archive entry path '{entryName}'.");
        if (normalized.Split('/', StringSplitOptions.RemoveEmptyEntries).Length > limits.MaxPathDepth)
            throw new InvalidDataException($"Package entry path '{entryName}' is nested too deeply.");

        string fullPath;
        try
        {
            fullPath = Path.GetFullPath(Path.Combine(destinationDirectory, normalized));
        }
        catch (Exception ex) when (ex is ArgumentException or PathTooLongException or NotSupportedException)
        {
            throw new InvalidDataException($"Unsafe archive entry path '{entryName}'.", ex);
        }

        if (!MnemoAppPaths.IsPathUnder(fullPath, destinationDirectory))
            throw new InvalidDataException($"Unsafe archive entry path '{entryName}'.");

        return fullPath;
    }

    /// <summary>
    /// Reads the table that maps a name inside the package to the filename card HTML refers to.
    /// The legacy layouts store it as a JSON object, the latest as a protobuf list whose position
    /// is the name of the file in the archive.
    /// </summary>
    private static async Task<IReadOnlyDictionary<string, string>> ReadMediaTableAsync(
        string destinationDirectory,
        AnkiPackageVersion version,
        ICollection<TransferWarning> warnings,
        CancellationToken cancellationToken)
    {
        var empty = new Dictionary<string, string>(StringComparer.Ordinal);
        var tablePath = Path.Combine(destinationDirectory, MediaTableEntryName);
        if (!File.Exists(tablePath))
            return empty;

        try
        {
            if (version != AnkiPackageVersion.Latest)
            {
                var json = await File.ReadAllTextAsync(tablePath, cancellationToken).ConfigureAwait(false);
                return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? empty;
            }

            var bytes = await File.ReadAllBytesAsync(tablePath, cancellationToken).ConfigureAwait(false);
            return ReadModernMediaTable(bytes);
        }
        catch (Exception ex) when (ex is JsonException or InvalidDataException or IOException)
        {
            warnings.Add(TransferWarning.Of("AnkiMediaTableUnreadable", ("error", ex.Message)));
            return empty;
        }
    }

    private static Dictionary<string, string> ReadModernMediaTable(ReadOnlySpan<byte> bytes)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        var reader = new AnkiProtobufReader(bytes);
        var position = 0;
        while (reader.TryReadFieldHeader(out var field, out var wireType))
        {
            if (field != MediaEntriesEntryField || wireType != AnkiProtobufReader.WireTypeLengthDelimited)
            {
                if (!reader.TrySkip(wireType))
                    break;
                continue;
            }

            if (!reader.TryReadLengthDelimited(out var entryBytes))
                break;

            // The list is positional: the n-th entry describes the archive member literally named
            // "n", so an unnamed entry still consumes its slot.
            var (name, legacyZipName) = ReadModernMediaEntry(entryBytes);
            var storedName = legacyZipName?.ToString(CultureInfo.InvariantCulture) ?? position.ToString(CultureInfo.InvariantCulture);
            if (!string.IsNullOrEmpty(name))
                map[storedName] = name;
            position++;
        }

        return map;
    }

    private static (string Name, uint? LegacyZipName) ReadModernMediaEntry(ReadOnlySpan<byte> entryBytes)
    {
        var name = string.Empty;
        uint? legacyZipName = null;
        var reader = new AnkiProtobufReader(entryBytes);
        while (reader.TryReadFieldHeader(out var field, out var wireType))
        {
            if (field == MediaEntryNameField && wireType == AnkiProtobufReader.WireTypeLengthDelimited)
            {
                if (!reader.TryReadLengthDelimited(out var raw))
                    break;
                name = Encoding.UTF8.GetString(raw);
                continue;
            }

            if (field == MediaEntryLegacyZipNameField && wireType == AnkiProtobufReader.WireTypeVarint)
            {
                if (!reader.TryReadVarint(out var value))
                    break;
                legacyZipName = value > uint.MaxValue ? null : (uint)value;
                continue;
            }

            if (!reader.TrySkip(wireType))
                break;
        }

        return (name, legacyZipName);
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
