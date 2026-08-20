using System.IO.Compression;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Packaging;

/// <summary>
/// ZIP-backed implementation for unified <c>.mnemo</c> package import/export.
/// </summary>
public sealed class MnemoPackageService : IMnemoPackageService
{
    private const string ManifestPath = "manifest.json";

    /// <summary>
    /// Settings key holding this installation's collection id. A setting rather than a column so no
    /// store gains a schema version for it; it is minted the first time a package is written.
    /// </summary>
    public const string CollectionIdSettingKey = "Collection.Id";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly IReadOnlyDictionary<string, IMnemoPayloadHandler> _handlers;
    private readonly ISettingsService _settings;
    private readonly ILoggerService _logger;
    private readonly PackageReadLimits _limits;

    public MnemoPackageService(IEnumerable<IMnemoPayloadHandler> handlers, ISettingsService settings, ILoggerService logger)
        : this(handlers, settings, logger, PackageReadLimits.Default)
    {
    }

    /// <summary>Test seam: the same service with smaller caps so a limit can be exercised cheaply.</summary>
    internal MnemoPackageService(
        IEnumerable<IMnemoPayloadHandler> handlers,
        ISettingsService settings,
        ILoggerService logger,
        PackageReadLimits limits)
    {
        _settings = settings;
        _logger = logger;
        _limits = limits;
        _handlers = handlers.ToDictionary(h => h.PayloadType, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// This installation's collection id, minted and stored the first time it is asked for.
    /// </summary>
    /// <remarks>
    /// A package written by a build that could not reach its settings still has to be written, so a
    /// failure here costs the manifest its id rather than costing the user their export.
    /// </remarks>
    private async Task<string?> ResolveCollectionIdAsync()
    {
        try
        {
            var existing = await _settings.GetAsync<string>(CollectionIdSettingKey, string.Empty).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(existing))
                return existing;

            var minted = Guid.NewGuid().ToString("N");
            await _settings.SetAsync(CollectionIdSettingKey, minted).ConfigureAwait(false);
            return minted;
        }
        catch (Exception ex)
        {
            _logger.Warning("MnemoPackageService", $"Could not resolve the collection id: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Anti-DoS caps on a package being read. A .mnemo arrives from anywhere the user can be talked
    /// into opening one, and the upload endpoint only bounds the COMPRESSED size; a zip bomb is small
    /// on disk and enormous once expanded, so the real limits sit on the uncompressed bytes and are
    /// enforced during the copy, not trusted from the header a bomb is free to forge. The defaults
    /// sit far above any real corpus (bounded by a 512 MB compressed upload) and far below a bomb
    /// (which expands hundreds of times over).
    /// </summary>
    internal sealed record PackageReadLimits(int MaxEntryCount, long MaxEntryBytes, long MaxTotalBytes, int MaxPathDepth)
    {
        public static readonly PackageReadLimits Default = new(
            MaxEntryCount: 50_000,
            MaxEntryBytes: 512L * 1024 * 1024,
            MaxTotalBytes: 2L * 1024 * 1024 * 1024,
            MaxPathDepth: 32);
    }

    public async Task<Result<MnemoPackageManifest>> ExportAsync(
        string outputFilePath,
        MnemoPackageExportOptions options,
        CancellationToken cancellationToken = default)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(outputFilePath))
                return Result<MnemoPackageManifest>.Failure("Output file path is required.");

            var selectedTypes = options.PayloadTypes is { Count: > 0 }
                ? new HashSet<string>(options.PayloadTypes, StringComparer.OrdinalIgnoreCase)
                : null;

            var selectedHandlers = _handlers.Values
                .Where(h => selectedTypes == null || selectedTypes.Contains(h.PayloadType))
                .OrderBy(h => h.PayloadType, StringComparer.OrdinalIgnoreCase)
                .ToArray();

            var directory = Path.GetDirectoryName(outputFilePath);
            if (!string.IsNullOrWhiteSpace(directory))
                Directory.CreateDirectory(directory);

            if (File.Exists(outputFilePath))
                File.Delete(outputFilePath);

            var manifest = new MnemoPackageManifest
            {
                Version = 1,
                Format = "mnemo-package",
                CreatedAtUtc = DateTimeOffset.UtcNow,
                CreatedByAppVersion = options.AppVersion,
                PackageKind = options.PackageKind,
                Kind = MnemoPackageKinds.Normalize(options.Kind),
                CollectionId = await ResolveCollectionIdAsync().ConfigureAwait(false)
            };

            await using var output = File.Create(outputFilePath);
            using var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: false);

            foreach (var handler in selectedHandlers)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var exportData = await handler.ExportAsync(new MnemoPayloadExportContext
                {
                    Options = options
                }, cancellationToken).ConfigureAwait(false);

                if (exportData.Files.Count == 0)
                    continue;

                var payloadRoot = $"payloads/{NormalizePathSegment(handler.PayloadType)}";
                foreach (var pair in exportData.Files)
                {
                    var relative = pair.Key.Replace('\\', '/').TrimStart('/');
                    var entryPath = $"{payloadRoot}/{relative}";
                    var entry = archive.CreateEntry(entryPath, CompressionLevel.Optimal);
                    await using var entryStream = entry.Open();
                    await entryStream.WriteAsync(pair.Value, cancellationToken).ConfigureAwait(false);
                }

                manifest.Entries.Add(new MnemoPackageEntry
                {
                    PayloadType = handler.PayloadType,
                    ItemCount = exportData.ItemCount,
                    SchemaVersion = exportData.SchemaVersion,
                    Path = payloadRoot
                });
            }

            var manifestEntry = archive.CreateEntry(ManifestPath, CompressionLevel.Optimal);
            await using (var manifestStream = manifestEntry.Open())
            {
                await JsonSerializer.SerializeAsync(manifestStream, manifest, JsonOptions, cancellationToken).ConfigureAwait(false);
            }

            return Result<MnemoPackageManifest>.Success(manifest);
        }
        catch (Exception ex)
        {
            _logger.Error("MnemoPackageService", "Failed to export package.", ex);
            return Result<MnemoPackageManifest>.Failure("Failed to export .mnemo package.", ex);
        }
    }

    public async Task<Result<MnemoPackageResult>> ImportAsync(
        string packageFilePath,
        MnemoPackageImportOptions options,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var previewResult = await ReadPackageManifestAsync(packageFilePath, cancellationToken).ConfigureAwait(false);
            if (!previewResult.IsSuccess)
                return Result<MnemoPackageResult>.Failure(previewResult.ErrorMessage ?? "Failed to read package manifest.", previewResult.Exception);

            var (manifest, archiveEntries) = previewResult.Value;
            var result = new MnemoPackageResult
            {
                Success = true,
                Manifest = manifest
            };

            var selectedTypes = options.PayloadTypes is { Count: > 0 }
                ? new HashSet<string>(options.PayloadTypes, StringComparer.OrdinalIgnoreCase)
                : null;

            foreach (var entry in manifest.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (selectedTypes != null && !selectedTypes.Contains(entry.PayloadType))
                    continue;

                if (!_handlers.TryGetValue(entry.PayloadType, out var handler))
                {
                    result.Warnings.Add(TransferWarning.Of("PackageUnknownPayloadSkipped", ("payloadType", entry.PayloadType)));
                    if (options.StrictUnknownPayloads)
                        return Result<MnemoPackageResult>.Failure($"Unknown payload type '{entry.PayloadType}' was skipped.");
                    continue;
                }

                var importResult = await handler.ImportAsync(new MnemoPayloadImportContext
                {
                    Entry = entry,
                    Options = options,
                    Files = FilesUnder(archiveEntries, entry),
                    Manifest = manifest
                }, cancellationToken).ConfigureAwait(false);

                result.ImportedCountsByPayload[entry.PayloadType] = importResult.ImportedCount;
                result.DuplicatedCountsByPayload[entry.PayloadType] = importResult.DuplicatedCount;
                result.SkippedCountsByPayload[entry.PayloadType] = importResult.SkippedCount;
                result.Warnings.AddRange(importResult.Warnings);
            }

            return Result<MnemoPackageResult>.Success(result);
        }
        catch (Exception ex)
        {
            _logger.Error("MnemoPackageService", "Failed to import package.", ex);
            return Result<MnemoPackageResult>.Failure("Failed to import .mnemo package.", ex);
        }
    }

    public async Task<Result<ImportExportPreview>> PreviewAsync(string packageFilePath, CancellationToken cancellationToken = default)
    {
        try
        {
            var previewResult = await ReadPackageManifestAsync(packageFilePath, cancellationToken).ConfigureAwait(false);
            if (!previewResult.IsSuccess)
                return Result<ImportExportPreview>.Failure(previewResult.ErrorMessage ?? "Failed to read package manifest.", previewResult.Exception);

            var (manifest, _) = previewResult.Value;
            var preview = new ImportExportPreview
            {
                CanImport = true,
                ContentType = "package",
                FormatId = "mnemo.package"
            };

            foreach (var entry in manifest.Entries)
            {
                preview.DiscoveredCounts[entry.PayloadType] = entry.ItemCount;
                if (!_handlers.ContainsKey(entry.PayloadType))
                    preview.Warnings.Add(TransferWarning.Of("PackagePreviewUnknownPayload", ("payloadType", entry.PayloadType)));
            }

            return Result<ImportExportPreview>.Success(preview);
        }
        catch (Exception ex)
        {
            _logger.Error("MnemoPackageService", "Failed to preview package.", ex);
            return Result<ImportExportPreview>.Failure("Failed to preview .mnemo package.", ex);
        }
    }

    public async Task<Result<MnemoPackageEvidence>> InspectAsync(string packageFilePath, CancellationToken cancellationToken = default)
    {
        try
        {
            var read = await ReadPackageManifestAsync(packageFilePath, cancellationToken).ConfigureAwait(false);
            if (!read.IsSuccess)
                return Result<MnemoPackageEvidence>.Failure(read.ErrorMessage ?? "Failed to read package manifest.", read.Exception);

            var (manifest, archiveEntries) = read.Value;
            var localCollectionId = await ResolveCollectionIdAsync().ConfigureAwait(false);
            var evidence = new MnemoPackageEvidence
            {
                Kind = MnemoPackageKinds.Normalize(manifest.Kind),
                CollectionId = manifest.CollectionId,
                FromThisCollection = !string.IsNullOrWhiteSpace(manifest.CollectionId)
                    && string.Equals(manifest.CollectionId, localCollectionId, StringComparison.OrdinalIgnoreCase),
                CreatedAtUtc = manifest.CreatedAtUtc,
                CreatedByAppVersion = manifest.CreatedByAppVersion
            };

            foreach (var entry in manifest.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!_handlers.TryGetValue(entry.PayloadType, out var handler) || handler is not IMnemoPayloadInspector inspector)
                    continue;

                var payload = await inspector.InspectAsync(new MnemoPayloadImportContext
                {
                    Entry = entry,
                    Options = new MnemoPackageImportOptions { PreviewOnly = true },
                    Files = FilesUnder(archiveEntries, entry),
                    Manifest = manifest
                }, cancellationToken).ConfigureAwait(false);

                evidence.Payloads.Add(payload);
                if (!payload.CanRead)
                    evidence.CanRead = false;
            }

            return Result<MnemoPackageEvidence>.Success(evidence);
        }
        catch (Exception ex)
        {
            _logger.Error("MnemoPackageService", "Failed to inspect package.", ex);
            return Result<MnemoPackageEvidence>.Failure("Failed to inspect .mnemo package.", ex);
        }
    }

    /// <summary>The archive entries belonging to one payload, keyed by their path inside it.</summary>
    private static Dictionary<string, byte[]> FilesUnder(
        IReadOnlyDictionary<string, byte[]> archiveEntries,
        MnemoPackageEntry entry)
    {
        var prefixLength = (entry.Path.TrimEnd('/') + "/").Length;
        return archiveEntries
            .Where(kvp => IsUnderPath(kvp.Key, entry.Path))
            .ToDictionary(kvp => kvp.Key[prefixLength..], kvp => kvp.Value, StringComparer.OrdinalIgnoreCase);
    }

    private async Task<Result<(MnemoPackageManifest Manifest, Dictionary<string, byte[]> Entries)>> ReadPackageManifestAsync(
        string packageFilePath,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(packageFilePath))
            return Result<(MnemoPackageManifest, Dictionary<string, byte[]>)>.Failure("Package file not found.");

        await using var file = File.OpenRead(packageFilePath);
        using var archive = new ZipArchive(file, ZipArchiveMode.Read, leaveOpen: false);

        var manifestEntry = archive.GetEntry(ManifestPath);
        if (manifestEntry == null)
            return Result<(MnemoPackageManifest, Dictionary<string, byte[]>)>.Failure("manifest.json is missing from package.");

        MnemoPackageManifest? manifest;
        await using (var manifestStream = manifestEntry.Open())
        {
            manifest = await JsonSerializer.DeserializeAsync<MnemoPackageManifest>(manifestStream, JsonOptions, cancellationToken).ConfigureAwait(false);
        }

        if (manifest == null)
            return Result<(MnemoPackageManifest, Dictionary<string, byte[]>)>.Failure("Invalid manifest.json.");
        if (!string.Equals(manifest.Format, "mnemo-package", StringComparison.OrdinalIgnoreCase))
            return Result<(MnemoPackageManifest, Dictionary<string, byte[]>)>.Failure("Unsupported package format.");
        if (manifest.Version != 1)
            return Result<(MnemoPackageManifest, Dictionary<string, byte[]>)>.Failure($"Unsupported package version '{manifest.Version}'.");

        var entries = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        var entryCount = 0;
        long totalBytes = 0;
        foreach (var entry in archive.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.Equals(entry.FullName, ManifestPath, StringComparison.OrdinalIgnoreCase))
                continue;
            if (string.IsNullOrWhiteSpace(entry.Name))
                continue;

            if (++entryCount > _limits.MaxEntryCount)
                throw new InvalidDataException($"Package contains more than {_limits.MaxEntryCount} entries.");

            ValidateArchiveEntryPath(entry.FullName);

            // A cheap first gate on the declared size; the copy below enforces the real one, since a
            // forged header is exactly how a bomb slips past a size check that trusts it.
            if (entry.Length > _limits.MaxEntryBytes)
                throw new InvalidDataException($"Package entry '{entry.FullName}' exceeds the {_limits.MaxEntryBytes / (1024 * 1024)} MB limit.");

            await using var stream = entry.Open();
            var bytes = await ReadEntryAsync(stream, _limits.MaxTotalBytes - totalBytes, entry.FullName, cancellationToken).ConfigureAwait(false);
            totalBytes += bytes.Length;
            entries[entry.FullName.Replace('\\', '/')] = bytes;
        }

        return Result<(MnemoPackageManifest, Dictionary<string, byte[]>)>.Success((manifest, entries));
    }

    /// <summary>
    /// Reads one entry into memory, aborting the moment it passes its own cap or the total budget
    /// left. The check rides the copy rather than the header so a lying uncompressed size cannot
    /// wave a bomb through.
    /// </summary>
    private async Task<byte[]> ReadEntryAsync(Stream source, long remainingTotal, string entryName, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await source.ReadAsync(chunk, cancellationToken).ConfigureAwait(false)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > _limits.MaxEntryBytes)
                throw new InvalidDataException($"Package entry '{entryName}' exceeds the {_limits.MaxEntryBytes / (1024 * 1024)} MB limit.");
            if (buffer.Length > remainingTotal)
                throw new InvalidDataException($"Package expands beyond the {_limits.MaxTotalBytes / (1024 * 1024)} MB total limit.");
        }

        return buffer.ToArray();
    }

    private void ValidateArchiveEntryPath(string entryPath)
    {
        var normalized = entryPath.Replace('\\', '/');
        if (normalized.StartsWith("/", StringComparison.Ordinal) ||
            normalized.Contains("../", StringComparison.Ordinal) ||
            normalized.Contains("..\\", StringComparison.Ordinal))
        {
            throw new InvalidDataException($"Unsafe archive entry path '{entryPath}'.");
        }

        var depth = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries).Length;
        if (depth > _limits.MaxPathDepth)
            throw new InvalidDataException($"Package entry path '{entryPath}' is nested too deeply.");
    }

    private static bool IsUnderPath(string fullPath, string rootPath)
    {
        var normalizedRoot = rootPath.Replace('\\', '/').TrimEnd('/') + "/";
        var normalizedFull = fullPath.Replace('\\', '/');
        return normalizedFull.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizePathSegment(string value)
    {
        return value.Trim().Replace('\\', '-').Replace('/', '-');
    }
}
