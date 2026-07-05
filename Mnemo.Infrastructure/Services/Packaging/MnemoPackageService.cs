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
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly IReadOnlyDictionary<string, IMnemoPayloadHandler> _handlers;
    private readonly ILoggerService _logger;

    public MnemoPackageService(IEnumerable<IMnemoPayloadHandler> handlers, ILoggerService logger)
    {
        _logger = logger;
        _handlers = handlers.ToDictionary(h => h.PayloadType, StringComparer.OrdinalIgnoreCase);
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
                PackageKind = options.PackageKind
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
                    var unknownMessage = $"Unknown payload type '{entry.PayloadType}' was skipped.";
                    result.Warnings.Add(unknownMessage);
                    if (options.StrictUnknownPayloads)
                        return Result<MnemoPackageResult>.Failure(unknownMessage);
                    continue;
                }

                var files = archiveEntries
                    .Where(kvp => IsUnderPath(kvp.Key, entry.Path))
                    .ToDictionary(kvp => kvp.Key[(entry.Path.TrimEnd('/') + "/").Length..], kvp => kvp.Value, StringComparer.OrdinalIgnoreCase);

                var importResult = await handler.ImportAsync(new MnemoPayloadImportContext
                {
                    Entry = entry,
                    Options = options,
                    Files = files
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
                    preview.Warnings.Add($"Unknown payload type '{entry.PayloadType}' will be skipped.");
            }

            return Result<ImportExportPreview>.Success(preview);
        }
        catch (Exception ex)
        {
            _logger.Error("MnemoPackageService", "Failed to preview package.", ex);
            return Result<ImportExportPreview>.Failure("Failed to preview .mnemo package.", ex);
        }
    }

    private static async Task<Result<(MnemoPackageManifest Manifest, Dictionary<string, byte[]> Entries)>> ReadPackageManifestAsync(
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
        foreach (var entry in archive.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.Equals(entry.FullName, ManifestPath, StringComparison.OrdinalIgnoreCase))
                continue;
            if (string.IsNullOrWhiteSpace(entry.Name))
                continue;

            ValidateArchiveEntryPath(entry.FullName);

            await using var stream = entry.Open();
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer, cancellationToken).ConfigureAwait(false);
            entries[entry.FullName.Replace('\\', '/')] = buffer.ToArray();
        }

        return Result<(MnemoPackageManifest, Dictionary<string, byte[]>)>.Success((manifest, entries));
    }

    private static void ValidateArchiveEntryPath(string entryPath)
    {
        var normalized = entryPath.Replace('\\', '/');
        if (normalized.StartsWith("/", StringComparison.Ordinal) ||
            normalized.Contains("../", StringComparison.Ordinal) ||
            normalized.Contains("..\\", StringComparison.Ordinal))
        {
            throw new InvalidDataException($"Unsafe archive entry path '{entryPath}'.");
        }
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
