using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Lifecycle;
using Mnemo.Host.Notes;
using Mnemo.Host.Transfer;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Trash;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Notes;

/// <summary>
/// The import route over a recording coordinator, so what reaches the adapter can be read back:
/// the folder a markdown import is filed into is an option on the request, and nothing else says
/// where a note went. The readiness gates the route carries are real, which is why a trash stack
/// over a throwaway database sits behind it.
/// </summary>
public sealed class NoteTransferImportTests : IAsyncDisposable
{
    private const string KnownFolder = "folder-biology";

    private readonly string _trashDbPath = Path.Combine(Path.GetTempPath(), $"mnemo_host_notes_{Guid.NewGuid():N}.db");
    private readonly WebApplication _app;
    private readonly RecordingCoordinator _transfer = new();
    private readonly RecordingLogger _logger = new();
    private readonly TrashDatabase _trashDatabase;
    private HttpClient? _client;
    private bool _started;

    public NoteTransferImportTests()
    {
        var logger = _logger;
        _trashDatabase = new TrashDatabase(logger, _trashDbPath);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        builder.Services.AddSingleton<ILoggerService>(logger);
        builder.Services.AddSingleton<IImportExportCoordinator>(_transfer);
        builder.Services.AddSingleton<INoteFolderService>(new OneFolder(KnownFolder));
        builder.Services.AddSingleton<INoteSidMigrator>(new MigratedNotes());

        // The export route is mapped by the same call and its delegate is built with the rest, so
        // its services have to be registrable. The two cheap ones are real; the note service is
        // resolved by that route alone, which nothing here reaches.
        builder.Services.AddSingleton(new ExportGrants());
        builder.Services.AddSingleton<ISettingsService>(new MemorySettings());
        builder.Services.AddSingleton<INoteService>(_ =>
            throw new InvalidOperationException("The export route is not part of these tests."));

        builder.Services.AddSingleton(_trashDatabase);
        builder.Services.AddSingleton<ITrashStore>(new TrashStore(_trashDatabase));
        builder.Services.AddSingleton<IAssetCleanupStore>(new AssetCleanupStore(_trashDatabase));
        builder.Services.AddSingleton(new TrashSourceRegistry([]));
        builder.Services.AddSingleton<TrashMaintenance>();
        builder.Services.AddSingleton<ITrashMaintenance>(sp => sp.GetRequiredService<TrashMaintenance>());
        builder.Services.AddSingleton<AssetCleanupWorker>();
        builder.Services.AddSingleton<ITrashService>(sp => new TrashService(
            sp.GetRequiredService<ITrashStore>(),
            sp.GetRequiredService<TrashSourceRegistry>(),
            sp.GetRequiredService<ILoggerService>(),
            sp.GetRequiredService<ITrashMaintenance>()));

        _app = builder.Build();
        _app.MapNoteTransfer();
    }

    [Fact]
    public async Task AFolderNobodyHasIsRefusedBeforeAnyFileIsRead()
    {
        var client = await ClientAsync();

        var response = await client.PostAsJsonAsync("/api/notes/transfer/import", new
        {
            uploadIds = new[] { "never-staged" },
            conflictPolicy = "KeepBoth",
            targetFolderId = "not-a-folder",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("unknown_folder", body.RootElement.GetProperty("error").GetString());
        Assert.Empty(_transfer.Imports);
    }

    [Fact]
    public async Task AKnownFolderReachesTheAdapterAsTheImportsDestination()
    {
        var client = await ClientAsync();
        var uploadId = Stage("Biology.md");

        var response = await client.PostAsJsonAsync("/api/notes/transfer/import", new
        {
            uploadIds = new[] { uploadId },
            conflictPolicy = "KeepBoth",
            targetFolderId = KnownFolder,
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(1, body.RootElement.GetProperty("succeededFiles").GetInt32());

        var request = Assert.Single(_transfer.Imports);
        Assert.Equal(KnownFolder, request.Options[ImportExportOptionKeys.TargetFolderId]);
    }

    [Fact]
    public async Task NoFolderNamesNoDestinationSoTheImportLandsAtTheRoot()
    {
        var client = await ClientAsync();
        var uploadId = Stage("Cells.md");

        var response = await client.PostAsJsonAsync("/api/notes/transfer/import", new
        {
            uploadIds = new[] { uploadId },
            conflictPolicy = "KeepBoth",
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var request = Assert.Single(_transfer.Imports);
        Assert.False(request.Options.ContainsKey(ImportExportOptionKeys.TargetFolderId));
    }

    [Fact]
    public async Task EveryWarningTheAdapterReports_ReachesTheAppLog()
    {
        // The app log keeps the complete, per-note list.
        _transfer.Warnings =
        [
            TransferWarning.Of("NoteImportFailed", ("noteTitle", "a"), ("error", "boom")),
            TransferWarning.Of("NoteImportFailed", ("noteTitle", "b"), ("error", "boom")),
        ];
        var client = await ClientAsync();
        var uploadId = Stage("Warnings.md");

        var response = await client.PostAsJsonAsync("/api/notes/transfer/import", new
        {
            uploadIds = new[] { uploadId },
            conflictPolicy = "KeepBoth",
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        // One log write for the whole import, not one per warning.
        var logged = Assert.Single(_logger.Entries, entry => entry.Category == "Notes.Transfer");
        Assert.Contains("noteTitle=a", logged.Message);
        Assert.Contains("noteTitle=b", logged.Message);
    }

    /// <summary>A staged markdown file, the way the upload route leaves one behind.</summary>
    private static string Stage(string fileName)
    {
        var (uploadId, path) = TransferStagingStore.CreateUpload(fileName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "# A note");
        return uploadId;
    }

    private async Task<HttpClient> ClientAsync()
    {
        if (_started)
            return _client!;

        await _app.StartAsync();
        _started = true;
        _client = _app.GetTestClient();

        // The import route stays closed until the first trash reconciliation, like every route
        // that can send content to the trash.
        var maintenance = _app.Services.GetRequiredService<TrashMaintenance>();
        maintenance.StartInBackground();
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (!maintenance.IsReady)
        {
            if (DateTime.UtcNow > deadline)
                throw new TimeoutException("The trash never finished starting.");
            await Task.Delay(10);
        }

        return _client;
    }

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_started)
            await _app.StopAsync();
        await _app.DisposeAsync();
        await _trashDatabase.DisposeAsync();

        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_trashDbPath + suffix); }
            catch (IOException) { /* a held sidecar is not a test failure */ }
        }
    }

    /// <summary>Answers every import as one note landed, and keeps the request it was handed.</summary>
    private sealed class RecordingCoordinator : IImportExportCoordinator
    {
        public List<ImportExportRequest> Imports { get; } = [];

        /// <summary>Warnings the next import(s) report back, unset by default.</summary>
        public List<TransferWarning> Warnings { get; set; } = [];

        public IReadOnlyList<ImportExportCapability> GetCapabilities(string? contentType = null) =>
        [
            new ImportExportCapability
            {
                ContentType = "notes",
                FormatId = "notes.markdown",
                DisplayName = "Markdown (.md)",
                Extensions = [".md"],
                SupportsImport = true,
                SupportsExport = true,
            },
        ];

        public Task<Result<ImportExportPreview>> PreviewImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ImportExportPreview>.Success(new ImportExportPreview
            {
                CanImport = true,
                ContentType = "notes",
                FormatId = "notes.markdown",
            }));

        public Task<Result<ImportExportResult>> ImportAsync(ImportExportRequest request, CancellationToken cancellationToken = default)
        {
            Imports.Add(request);
            return Task.FromResult(Result<ImportExportResult>.Success(new ImportExportResult
            {
                Success = true,
                ContentType = "notes",
                FormatId = "notes.markdown",
                ProcessedCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase) { ["notes"] = 1 },
                Warnings = Warnings,
            }));
        }

        public Task<Result<ImportExportResult>> ExportAsync(ImportExportRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ImportExportResult>.Failure("Export is not part of these tests."));
    }

    private sealed class OneFolder(string folderId) : INoteFolderService
    {
        private readonly NoteFolder _folder = new() { FolderId = folderId, Name = "Biology" };

        public Task<IEnumerable<NoteFolder>> GetAllFoldersAsync() => Task.FromResult<IEnumerable<NoteFolder>>([_folder]);

        public Task<NoteFolder?> GetFolderAsync(string id) =>
            Task.FromResult(id == _folder.FolderId ? _folder : null);

        public Task<Result> SaveFolderAsync(NoteFolder folder) => Task.FromResult(Result.Success());

        public Task<Result> DeleteFolderAsync(string id) => Task.FromResult(Result.Success());
    }

    private sealed class MigratedNotes : INoteSidMigrator
    {
        public bool IsComplete => true;

        public Task MigrateAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    /// <summary>Keeps every line logged.</summary>
    private sealed class RecordingLogger : ILoggerService
    {
        public List<(string Category, string Message)> Entries { get; } = [];

        public void Log(LogLevel level, string category, string message, Exception? exception = null) =>
            Entries.Add((category, message));
    }

    private sealed class MemorySettings : ISettingsService
    {
        private readonly Dictionary<string, object?> _values = new(StringComparer.Ordinal);

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
