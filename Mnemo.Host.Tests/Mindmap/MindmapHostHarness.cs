using Mnemo.Core.Enums;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Host.Tests.Mindmap;

/// <summary>
/// A real store and service over a throwaway database, so the endpoints are exercised against the
/// thing they will actually run against rather than a stand-in that agrees with them by construction.
/// </summary>
internal sealed class MindmapHostHarness : IAsyncDisposable
{
    private readonly string _dbPath;
    private readonly MindmapStore _store;

    public MindmapDocumentService Service { get; }

    public MindmapHostHarness()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_host_mm_{Guid.NewGuid():N}.db");
        _store = new MindmapStore(new SilentLogger(), _dbPath);
        Service = new MindmapDocumentService(_store, new SilentLogger());
    }

    public async ValueTask DisposeAsync()
    {
        await _store.DisposeAsync();
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
