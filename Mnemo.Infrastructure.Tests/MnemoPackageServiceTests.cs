using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Packaging;

namespace Mnemo.Infrastructure.Tests;

public sealed class MnemoPackageServiceTests
{
    [Fact]
    public async Task ExportAndPreviewAsync_WritesManifestAndDiscoversPayloadCounts()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"mnemo-test-{Guid.NewGuid():N}.mnemo");
        try
        {
            var service = new MnemoPackageService(
                [new StaticPayloadHandler("notes", 2), new StaticPayloadHandler("mindmaps", 1)],
                new MemorySettings(),
                new NullLogger());

            var export = await service.ExportAsync(tempFile, new MnemoPackageExportOptions());
            Assert.True(export.IsSuccess);

            var preview = await service.PreviewAsync(tempFile);
            Assert.True(preview.IsSuccess);
            Assert.NotNull(preview.Value);
            Assert.Equal(2, preview.Value.DiscoveredCounts["notes"]);
            Assert.Equal(1, preview.Value.DiscoveredCounts["mindmaps"]);
        }
        finally
        {
            if (File.Exists(tempFile))
                File.Delete(tempFile);
        }
    }

    [Fact]
    public async Task ImportAsync_UnknownPayload_WarnsAndContinuesWhenNotStrict()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"mnemo-test-{Guid.NewGuid():N}.mnemo");
        try
        {
            var manifest = new MnemoPackageManifest
            {
                Entries =
                [
                    new MnemoPackageEntry
                    {
                        PayloadType = "unknown.payload",
                        ItemCount = 1,
                        Path = "payloads/unknown.payload"
                    }
                ]
            };

            await using (var file = File.Create(tempFile))
            using (var zip = new ZipArchive(file, ZipArchiveMode.Create, leaveOpen: false))
            {
                var manifestEntry = zip.CreateEntry("manifest.json");
                await using (var stream = manifestEntry.Open())
                {
                    await JsonSerializer.SerializeAsync(stream, manifest);
                }

                var dataEntry = zip.CreateEntry("payloads/unknown.payload/data.json");
                await using (var dataStream = dataEntry.Open())
                {
                    var data = Encoding.UTF8.GetBytes("{\"x\":1}");
                    await dataStream.WriteAsync(data);
                }
            }

            var service = new MnemoPackageService([], new MemorySettings(), new NullLogger());
            var result = await service.ImportAsync(tempFile, new MnemoPackageImportOptions
            {
                StrictUnknownPayloads = false
            });

            Assert.True(result.IsSuccess);
            Assert.NotNull(result.Value);
            Assert.Contains(result.Value.Warnings, w => w.Key == "PackageUnknownPayloadSkipped");
        }
        finally
        {
            if (File.Exists(tempFile))
                File.Delete(tempFile);
        }
    }

    [Fact]
    public async Task ImportAsync_RejectsMoreEntriesThanTheCap()
    {
        var file = await WritePackageAsync(new MnemoPackageManifest(),
            ("payloads/notes/a", [1]),
            ("payloads/notes/b", [2]));
        try
        {
            var service = new MnemoPackageService([], new MemorySettings(), new NullLogger(),
                new MnemoPackageService.PackageReadLimits(MaxEntryCount: 1, MaxEntryBytes: 1024, MaxTotalBytes: 1024, MaxPathDepth: 32));

            var result = await service.ImportAsync(file, new MnemoPackageImportOptions());

            Assert.False(result.IsSuccess);
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task ImportAsync_RejectsAnEntryOverTheByteCap()
    {
        var file = await WritePackageAsync(new MnemoPackageManifest(),
            ("payloads/notes/big", new byte[64]));
        try
        {
            var service = new MnemoPackageService([], new MemorySettings(), new NullLogger(),
                new MnemoPackageService.PackageReadLimits(MaxEntryCount: 100, MaxEntryBytes: 16, MaxTotalBytes: 1024, MaxPathDepth: 32));

            var result = await service.ImportAsync(file, new MnemoPackageImportOptions());

            Assert.False(result.IsSuccess);
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task ImportAsync_RejectsAnEntryNestedTooDeeply()
    {
        var file = await WritePackageAsync(new MnemoPackageManifest(),
            ("payloads/notes/deep/deeper/file", [1]));
        try
        {
            var service = new MnemoPackageService([], new MemorySettings(), new NullLogger(),
                new MnemoPackageService.PackageReadLimits(MaxEntryCount: 100, MaxEntryBytes: 1024, MaxTotalBytes: 1024, MaxPathDepth: 2));

            var result = await service.ImportAsync(file, new MnemoPackageImportOptions());

            Assert.False(result.IsSuccess);
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task ExportAsync_DeclaresWhatThePackageIsAndWhichCollectionWroteIt()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"mnemo-test-{Guid.NewGuid():N}.mnemo");
        try
        {
            var settings = new MemorySettings();
            var service = new MnemoPackageService([new StaticPayloadHandler("notes", 1)], settings, new NullLogger());

            var export = await service.ExportAsync(tempFile, new MnemoPackageExportOptions
            {
                Kind = MnemoPackageKinds.Backup
            });

            Assert.True(export.IsSuccess);
            Assert.Equal(MnemoPackageKinds.Backup, export.Value!.Kind);
            var collectionId = export.Value.CollectionId;
            Assert.False(string.IsNullOrWhiteSpace(collectionId));

            // The id is the collection's, not the package's: a second export from the same
            // installation carries the same one, which is what lets a reader say "this came from
            // here" rather than "this came from some export".
            var second = await service.ExportAsync(tempFile, new MnemoPackageExportOptions());
            Assert.Equal(collectionId, second.Value!.CollectionId);
            Assert.Equal(MnemoPackageKinds.Export, second.Value.Kind);
        }
        finally
        {
            if (File.Exists(tempFile))
                File.Delete(tempFile);
        }
    }

    [Fact]
    public async Task InspectAsync_SaysWhetherThePackageCameFromHere()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"mnemo-test-{Guid.NewGuid():N}.mnemo");
        try
        {
            var settings = new MemorySettings();
            var service = new MnemoPackageService([new StaticPayloadHandler("notes", 1)], settings, new NullLogger());
            await service.ExportAsync(tempFile, new MnemoPackageExportOptions { Kind = MnemoPackageKinds.Backup });

            var mine = await service.InspectAsync(tempFile);
            Assert.True(mine.IsSuccess);
            Assert.Equal(MnemoPackageKinds.Backup, mine.Value!.Kind);
            Assert.True(mine.Value.FromThisCollection);

            // The same file read on another installation is a package from somewhere else.
            var elsewhere = new MnemoPackageService([new StaticPayloadHandler("notes", 1)], new MemorySettings(), new NullLogger());
            var theirs = await elsewhere.InspectAsync(tempFile);
            Assert.True(theirs.IsSuccess);
            Assert.False(theirs.Value!.FromThisCollection);
        }
        finally
        {
            if (File.Exists(tempFile))
                File.Delete(tempFile);
        }
    }

    [Fact]
    public async Task ImportAsync_TellsAHandlerWhatKindOfPackageItIsReading()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"mnemo-test-{Guid.NewGuid():N}.mnemo");
        try
        {
            var handler = new StaticPayloadHandler("notes", 1);
            var service = new MnemoPackageService([handler], new MemorySettings(), new NullLogger());
            await service.ExportAsync(tempFile, new MnemoPackageExportOptions { Kind = MnemoPackageKinds.Backup });

            await service.ImportAsync(tempFile, new MnemoPackageImportOptions());

            Assert.Equal(MnemoPackageKinds.Backup, handler.LastImportedKind);
        }
        finally
        {
            if (File.Exists(tempFile))
                File.Delete(tempFile);
        }
    }

    private static async Task<string> WritePackageAsync(MnemoPackageManifest manifest, params (string Path, byte[] Bytes)[] entries)
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"mnemo-test-{Guid.NewGuid():N}.mnemo");
        await using var file = File.Create(tempFile);
        using var zip = new ZipArchive(file, ZipArchiveMode.Create, leaveOpen: false);

        var manifestEntry = zip.CreateEntry("manifest.json");
        await using (var stream = manifestEntry.Open())
            await JsonSerializer.SerializeAsync(stream, manifest);

        foreach (var (path, bytes) in entries)
        {
            var entry = zip.CreateEntry(path);
            await using var entryStream = entry.Open();
            await entryStream.WriteAsync(bytes);
        }

        return tempFile;
    }

    private sealed class StaticPayloadHandler : IMnemoPayloadHandler
    {
        private readonly int _count;

        public StaticPayloadHandler(string payloadType, int count)
        {
            PayloadType = payloadType;
            _count = count;
        }

        public string PayloadType { get; }

        /// <summary>The manifest kind the last import handed this handler, for asserting on.</summary>
        public string? LastImportedKind { get; private set; }

        public Task<MnemoPayloadExportData> ExportAsync(MnemoPayloadExportContext context, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(new MnemoPayloadExportData
            {
                ItemCount = _count,
                Files = new Dictionary<string, byte[]>
                {
                    ["data.json"] = Encoding.UTF8.GetBytes("{}")
                }
            });
        }

        public Task<MnemoPayloadImportResult> ImportAsync(MnemoPayloadImportContext context, CancellationToken cancellationToken = default)
        {
            LastImportedKind = context.Manifest.Kind;
            return Task.FromResult(new MnemoPayloadImportResult { ImportedCount = _count });
        }
    }

    private sealed class NullLogger : ILoggerService
    {
        public void Log(Mnemo.Core.Enums.LogLevel level, string category, string message, Exception? exception = null) { }
    }

    /// <summary>Settings that live only for one test, so a collection id is minted per instance.</summary>
    private sealed class MemorySettings : ISettingsService
    {
        private readonly Dictionary<string, object?> _values = new(StringComparer.OrdinalIgnoreCase);

        public event EventHandler<string>? SettingChanged;

        public Task<T> GetAsync<T>(string key, T defaultValue = default!) =>
            Task.FromResult(_values.TryGetValue(key, out var value) && value is T typed ? typed : defaultValue);

        public Task SetAsync<T>(string key, T value)
        {
            _values[key] = value;
            SettingChanged?.Invoke(this, key);
            return Task.CompletedTask;
        }

        public Task<bool> ExistsAsync(string key) =>
            Task.FromResult(_values.TryGetValue(key, out var value) && value is not null);
    }
}
