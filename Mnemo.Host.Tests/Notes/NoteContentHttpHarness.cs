using System.Collections.Concurrent;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Host.Notes;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Notes.Persistence;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Notes;

/// <summary>
/// The note routes over a real commit store on a throwaway database, mapped through TestServer
/// so a request runs the production handler, its model binding and the migration gate in front
/// of it. The delete route needs a trash coordinator to resolve at startup; nothing here calls
/// it, so it gets one that refuses every call.
/// </summary>
internal sealed class NoteContentHttpHarness : IAsyncDisposable
{
    private readonly string _directory;
    private readonly WebApplication _app;
    private bool _started;
    private HttpClient? _client;

    public NoteContentHttpHarness()
    {
        _directory = Path.Combine(Path.GetTempPath(), "mnemo-host-notes", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_directory);
        var databasePath = Path.Combine(_directory, "mnemo.db");

        var storage = new SqliteStorageProvider(Logger, databasePath);
        Store = new NoteCommitStore(Logger, databasePath);
        Notes = new NoteService(storage, Store, Store, Store);
        var folders = new NoteFolderService(storage, Store, Store);
        Migrator = new NoteSidMigrator(storage, Notes, Store, Logger, databasePath);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        builder.Services.AddSingleton<ILoggerService>(Logger);
        builder.Services.AddSingleton<INoteService>(Notes);
        builder.Services.AddSingleton<INoteFolderService>(folders);
        builder.Services.AddSingleton<INoteCommitStore>(Store);
        builder.Services.AddSingleton<INoteSidMigrator>(Migrator);
        builder.Services.AddSingleton<ITrashService>(new UnreachableTrashService());

        _app = builder.Build();
        _app.MapNotes();
    }

    public RecordingLogger Logger { get; } = new();

    public NoteCommitStore Store { get; }

    public NoteService Notes { get; }

    public NoteSidMigrator Migrator { get; }

    public HttpClient Client => _client ?? throw new InvalidOperationException(
        "Call StartAsync before using Client.");

    /// <summary>
    /// Starts the application and, unless a test wants the routes still closed, runs the sid
    /// migration that opens them.
    /// </summary>
    public async Task StartAsync(bool migrated = true)
    {
        if (!_started)
        {
            await _app.StartAsync().ConfigureAwait(false);
            _started = true;
            _client = _app.GetTestClient();
        }

        if (migrated)
            await Migrator.MigrateAsync().ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_started)
            await _app.StopAsync().ConfigureAwait(false);
        await _app.DisposeAsync().ConfigureAwait(false);
        await Store.DisposeAsync().ConfigureAwait(false);

        try
        {
            Directory.Delete(_directory, recursive: true);
        }
        catch (IOException)
        {
            // A scratch directory that outlives the test run is noise, not a failure.
        }
    }

    internal sealed class RecordingLogger : ILoggerService
    {
        private readonly ConcurrentQueue<string> _errors = new();

        public IReadOnlyList<string> Errors => [.. _errors];

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
            if (level >= LogLevel.Error)
                _errors.Enqueue($"{category}: {message} {exception}");
        }
    }

    private sealed class UnreachableTrashService : ITrashService
    {
        public IReadOnlyCollection<string> RegisteredKinds => throw Unreachable();

        public Task<TrashAction> DeleteAsync(IReadOnlyCollection<TrashDeleteRequest> items, CancellationToken cancellationToken = default) => throw Unreachable();

        public Task<TrashPage> ListAsync(TrashListQuery query, CancellationToken cancellationToken = default) => throw Unreachable();

        public Task<int> CountAsync(CancellationToken cancellationToken = default) => throw Unreachable();

        public Task<IReadOnlyList<TrashRestoreResult>> RestoreAsync(IReadOnlyCollection<string> entryIds, TrashRestoreTarget? target = null, CancellationToken cancellationToken = default) => throw Unreachable();

        public Task<IReadOnlyList<TrashRestoreResult>> RestoreBatchAsync(string batchId, CancellationToken cancellationToken = default) => throw Unreachable();

        public Task<TrashPurgeResult> PurgeAsync(string entryId, CancellationToken cancellationToken = default) => throw Unreachable();

        public Task<TrashEmptyResult> EmptyAsync(CancellationToken cancellationToken = default) => throw Unreachable();

        public Task<int> SweepExpiredAsync(CancellationToken cancellationToken = default) => throw Unreachable();

        public Task ReconcileAsync(CancellationToken cancellationToken = default) => throw Unreachable();

        private static NotSupportedException Unreachable() =>
            new("The note content harness maps no trash behaviour.");
    }
}
