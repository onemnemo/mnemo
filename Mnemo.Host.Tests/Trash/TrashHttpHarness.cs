using System.Net.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Trash;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Trash;

/// <summary>
/// The real trash coordinator over a throwaway database, mapped onto its real routes through
/// TestServer, so a request runs the production endpoint code including its readiness and failure
/// filters.
/// </summary>
internal sealed class TrashHttpHarness : IAsyncDisposable
{
    /// <summary>The kind the fake module owns.</summary>
    public const string NoteKind = "note";

    private readonly string _dbPath;
    private readonly WebApplication _app;
    private HttpClient? _client;
    private bool _started;

    public TrashHttpHarness()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_host_trash_{Guid.NewGuid():N}.db");

        var logger = new SilentLogger();
        Database = new TrashDatabase(logger, _dbPath);
        Store = new TrashStore(Database);
        Notes = new FakeHostTrashSource(NoteKind);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        builder.Services.AddSingleton<ILoggerService>(logger);
        builder.Services.AddSingleton(Database);
        builder.Services.AddSingleton<ITrashStore>(Store);
        builder.Services.AddSingleton<IAssetCleanupStore>(new AssetCleanupStore(Database));
        builder.Services.AddSingleton(new TrashSourceRegistry([Notes]));
        builder.Services.AddSingleton<TrashMaintenance>();
        builder.Services.AddSingleton<ITrashMaintenance>(sp => sp.GetRequiredService<TrashMaintenance>());
        builder.Services.AddSingleton<AssetCleanupWorker>();
        builder.Services.AddSingleton<ITrashService>(sp => new TrashService(
            sp.GetRequiredService<ITrashStore>(),
            sp.GetRequiredService<TrashSourceRegistry>(),
            sp.GetRequiredService<ILoggerService>(),
            sp.GetRequiredService<ITrashMaintenance>()));

        _app = builder.Build();
        _app.MapTrash();
    }

    /// <summary>The shared trash tables.</summary>
    public TrashDatabase Database { get; }

    /// <summary>The ledger, for planting a row no endpoint would produce.</summary>
    public TrashStore Store { get; }

    /// <summary>The fake module.</summary>
    public FakeHostTrashSource Notes { get; }

    /// <summary>The coordinator the routes run against.</summary>
    public ITrashService Service => _app.Services.GetRequiredService<ITrashService>();

    /// <summary>Only valid once the application has been started.</summary>
    public HttpClient Client => _client ?? throw new InvalidOperationException(
        "Call StartAsync before using Client.");

    /// <summary>
    /// Starts the application and, unless a test wants the starting state, waits for the first
    /// reconciliation to open the routes.
    /// </summary>
    public async Task StartAsync(bool reconciled = true)
    {
        if (!_started)
        {
            await _app.StartAsync().ConfigureAwait(false);
            _started = true;
            _client = _app.GetTestClient();
        }

        if (!reconciled)
            return;

        var maintenance = _app.Services.GetRequiredService<TrashMaintenance>();
        maintenance.StartInBackground();

        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (!maintenance.IsReady)
        {
            if (DateTime.UtcNow > deadline)
                throw new TimeoutException("The trash never finished starting.");
            await Task.Delay(10).ConfigureAwait(false);
        }
    }

    /// <summary>Deletes one item of the fake module's kind, as a module endpoint would.</summary>
    public Task<TrashAction> DeleteAsync(params string[] itemIds) =>
        Service.DeleteAsync(itemIds.Select(id => new TrashDeleteRequest(NoteKind, id)).ToList());

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_started)
            await _app.StopAsync().ConfigureAwait(false);
        await _app.DisposeAsync().ConfigureAwait(false);
        await Database.DisposeAsync().ConfigureAwait(false);

        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_dbPath + suffix); }
            catch { /* best effort: a held WAL sidecar is not a test failure */ }
        }
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }
}
