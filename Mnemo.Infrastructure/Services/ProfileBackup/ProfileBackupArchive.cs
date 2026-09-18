using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using NuGet.Versioning;

namespace Mnemo.Infrastructure.Services.ProfileBackup;

internal static class ProfileBackupArchive
{
    public const string ManifestPath = "manifest.json";
    public const string DatabasePath = "profile.db";
    public const int FormatVersion = 1;
    private const int MaxPathCharacters = 1024;
    private const int MaxNameCharacters = 255;

    private static readonly HashSet<string> ManagedDirectories =
        new(ProfileBackupService.ManagedDirectoryNames, StringComparer.Ordinal);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    internal sealed record ReadLimits(
        int MaxEntryCount,
        long MaxEntryBytes,
        long MaxTotalBytes,
        int MaxPathDepth)
    {
        // Room for one entry at the longest path the layout allows, escaped, plus its fields.
        private const int ManifestBytesPerEntry = 2048;

        public static readonly ReadLimits Default = new(
            MaxEntryCount: 100_000,
            MaxEntryBytes: 2L * 1024 * 1024 * 1024,
            MaxTotalBytes: 20L * 1024 * 1024 * 1024,
            MaxPathDepth: 3);

        /// <summary>
        /// The largest manifest the entry limit can describe. A bound on untrusted input before
        /// it is parsed, so it follows the entry limit rather than a size of its own.
        /// </summary>
        public long MaxManifestBytes => (long)MaxEntryCount * ManifestBytesPerEntry;
    }

    public static JsonSerializerOptions SerializerOptions => JsonOptions;

    internal static bool IsValidAppVersion(string value) => ParseVersion(value) is not null;

    public static async Task<ProfileBackupManifest> ValidateAsync(
        string backupFilePath,
        string currentAppVersion,
        ReadLimits? limits = null,
        string? extractionDirectory = null,
        string? databaseExtractionPath = null,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(backupFilePath))
            throw Error("backup_not_found", "The backup file could not be found.");

        limits ??= ReadLimits.Default;
        await using var file = new FileStream(
            backupFilePath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
        using var archive = new ZipArchive(file, ZipArchiveMode.Read, leaveOpen: false);

        var normalized = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
        long declaredTotal = 0;
        foreach (var entry in archive.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (entries.Count >= limits.MaxEntryCount)
                throw Error("backup_too_many_files", "The backup contains too many files.");
            ValidateEntry(entry, limits);
            var canonical = entry.FullName.Normalize(NormalizationForm.FormC);
            if (!normalized.Add(canonical))
                throw Error("backup_duplicate_path", "The backup contains duplicate file paths.");

            if (entry.Length > limits.MaxEntryBytes || entry.Length > limits.MaxTotalBytes - declaredTotal)
                throw Error("backup_too_large", "The backup exceeds the supported size limit.");
            declaredTotal += entry.Length;

            entries.Add(canonical, entry);
        }

        if (!entries.TryGetValue(ManifestPath, out var manifestEntry))
            throw Error("backup_manifest_missing", "The backup manifest is missing.");
        if (manifestEntry.Length > limits.MaxManifestBytes)
            throw Error("backup_manifest_invalid", "The backup manifest is too large.");

        ProfileBackupManifest? manifest;
        await using (var stream = manifestEntry.Open())
        {
            try
            {
                manifest = await JsonSerializer.DeserializeAsync<ProfileBackupManifest>(
                    stream, JsonOptions, cancellationToken).ConfigureAwait(false);
            }
            catch (JsonException ex)
            {
                throw Error("backup_manifest_invalid", "The backup manifest is malformed.", ex);
            }
        }

        if (manifest is null || !string.Equals(manifest.Format, "mnemo-backup", StringComparison.Ordinal))
            throw Error("backup_format_unsupported", "This is not a Mnemo profile backup.");
        if (manifest.Contents is null || manifest.Entries is null ||
            string.IsNullOrWhiteSpace(manifest.CreatedByAppVersion) || manifest.CreatedAtUtc == default)
        {
            throw Error("backup_manifest_invalid", "The backup manifest is incomplete.");
        }
        if (manifest.FormatVersion > FormatVersion)
            throw Error("backup_version_newer", "This backup uses a newer format that this version of Mnemo cannot restore.");
        if (manifest.FormatVersion != FormatVersion)
            throw Error("backup_version_unsupported", "This backup format is not supported.");
        if (!IsValidAppVersion(manifest.CreatedByAppVersion))
            throw Error("backup_manifest_invalid", "The backup manifest contains an invalid application version.");
        if (IsNewer(manifest.CreatedByAppVersion, currentAppVersion))
            throw Error("backup_app_newer", "This backup was created by a newer version of Mnemo.");

        var declared = new Dictionary<string, ProfileBackupEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in manifest.Entries)
        {
            if (item is null)
                throw Error("backup_manifest_invalid", "The backup manifest contains an invalid entry.");
            ValidatePath(item.Path, limits.MaxPathDepth);
            if (string.Equals(item.Path, ManifestPath, StringComparison.OrdinalIgnoreCase))
                throw Error("backup_manifest_invalid", "The backup manifest cannot list itself as profile data.");
            if (!declared.TryAdd(item.Path.Normalize(NormalizationForm.FormC), item))
                throw Error("backup_duplicate_path", "The backup manifest contains duplicate file paths.");
            if (item.Size < 0 || item.Size > limits.MaxEntryBytes || !IsSha256(item.Sha256))
                throw Error("backup_manifest_invalid", "The backup manifest contains invalid file metadata.");
        }

        if (!declared.ContainsKey(DatabasePath))
            throw Error("backup_database_missing", "The backup does not contain the profile database.");
        if (entries.Keys.Any(path => path != ManifestPath && !declared.ContainsKey(path)))
            throw Error("backup_unknown_file", "The backup contains a file that is not listed in its manifest.");

        long expandedTotal = 0;
        foreach (var item in declared.Values.OrderBy(entry => entry.Path, StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!entries.TryGetValue(item.Path.Normalize(NormalizationForm.FormC), out var entry))
                throw Error("backup_file_missing", "A file listed in the backup manifest is missing.");
            if (entry.Length != item.Size)
                throw Error("backup_size_mismatch", "A file in the backup has the wrong size.");

            var destination = extractionDirectory is not null
                ? OpenExtractionFile(extractionDirectory, item.Path)
                : item.Path == DatabasePath && databaseExtractionPath is not null
                    ? OpenDatabaseExtractionFile(databaseExtractionPath)
                    : Stream.Null;
            await using (destination)
            await using (var source = entry.Open())
            using (var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
            {
                var copied = await CopyAndHashAsync(
                    source, destination, hash, item.Path, item.Size, limits.MaxEntryBytes,
                    limits.MaxTotalBytes - expandedTotal, cancellationToken).ConfigureAwait(false);
                expandedTotal += copied;
                var actual = Convert.ToHexStringLower(hash.GetHashAndReset());
                if (!CryptographicOperations.FixedTimeEquals(
                        Convert.FromHexString(actual), Convert.FromHexString(item.Sha256)))
                {
                    throw Error("backup_checksum_failed", "A file in the backup failed its integrity check.");
                }
            }
        }

        return manifest;
    }

    private static FileStream OpenDatabaseExtractionFile(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        return new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
    }

    private static FileStream OpenExtractionFile(string root, string relativePath)
    {
        var destination = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        var normalizedRoot = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
        if (!destination.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            throw Error("backup_path_unsafe", "The backup contains an unsafe file path.");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        return new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true);
    }

    private static async Task<long> CopyAndHashAsync(
        Stream source,
        Stream destination,
        IncrementalHash hash,
        string path,
        long expectedSize,
        long entryLimit,
        long totalRemaining,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
        {
            total += read;
            if (total > entryLimit || total > totalRemaining)
                throw Error("backup_too_large", "The backup expands beyond the supported size limit.");
            hash.AppendData(buffer, 0, read);
            await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }

        if (total != expectedSize)
            throw Error("backup_size_mismatch", $"The backup entry '{path}' ended at an unexpected size.");
        return total;
    }

    private static void ValidateEntry(ZipArchiveEntry entry, ReadLimits limits)
    {
        if (string.IsNullOrEmpty(entry.Name))
            throw Error("backup_directory_entry", "The backup contains a directory entry.");
        ValidatePath(entry.FullName, limits.MaxPathDepth);

        var unixType = (entry.ExternalAttributes >> 16) & 0xF000;
        var windowsAttributes = (FileAttributes)(entry.ExternalAttributes & 0xFFFF);
        if (unixType == 0x4000 || windowsAttributes.HasFlag(FileAttributes.Directory))
            throw Error("backup_directory_entry", "The backup contains a directory entry.");
        if (unixType == 0xA000 || windowsAttributes.HasFlag(FileAttributes.ReparsePoint))
            throw Error("backup_link_rejected", "The backup contains a link, which is not allowed.");
        if (unixType != 0 && unixType != 0x8000)
            throw Error("backup_link_rejected", "The backup contains a special file, which is not allowed.");
    }

    internal static void ValidatePath(string path, int maxDepth)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > MaxPathCharacters || path.Contains('\\') ||
            path.StartsWith('/') || path.Contains(':'))
            throw Error("backup_path_unsafe", "The backup contains an unsafe file path.");

        var parts = path.Split('/');
        if (parts.Length > maxDepth || parts.Any(part => part.Length == 0 || part is "." or ".." ||
            part.Length > MaxNameCharacters || part.EndsWith(' ') || part.EndsWith('.') ||
            IsReservedWindowsName(part) || part.Any(char.IsControl) ||
            part.IndexOfAny(['<', '>', '"', '|', '?', '*']) >= 0))
        {
            throw Error("backup_path_unsafe", "The backup contains an unsafe file path.");
        }

        if (!IsKnownPath(parts))
            throw Error("backup_unknown_file", "The backup contains a file outside the profile backup layout.");
    }

    private static bool IsKnownPath(IReadOnlyList<string> parts) =>
        parts.Count == 1 && (parts[0] == ManifestPath || parts[0] == DatabasePath) ||
        parts.Count == 3 && parts[0] == "assets" && ManagedDirectories.Contains(parts[1]);

    private static bool IsReservedWindowsName(string part)
    {
        var stem = part.Split('.', 2)[0];
        return stem.Equals("CON", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("PRN", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("AUX", StringComparison.OrdinalIgnoreCase) ||
            stem.Equals("NUL", StringComparison.OrdinalIgnoreCase) ||
            stem.Length == 4 && char.IsAsciiDigit(stem[3]) && stem[3] != '0' &&
            (stem.StartsWith("COM", StringComparison.OrdinalIgnoreCase) ||
                stem.StartsWith("LPT", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsSha256(string? value) =>
        value is { Length: 64 } && value.All(character => char.IsAsciiHexDigit(character));

    private static bool IsNewer(string backupVersion, string currentVersion)
    {
        var backup = ParseVersion(backupVersion);
        var current = ParseVersion(currentVersion);
        return backup is not null && current is not null && backup > current;
    }

    private static NuGetVersion? ParseVersion(string value)
    {
        return NuGetVersion.TryParse(value, out var parsed) ? parsed : null;
    }

    private static ProfileBackupException Error(string code, string message, Exception? inner = null) =>
        inner is null ? new ProfileBackupException(code, message) : new ProfileBackupException(code, message, inner);
}
