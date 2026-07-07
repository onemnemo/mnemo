using System;
using System.IO;
using System.Threading.Tasks;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Spins up a <see cref="MindmapStore"/> and <see cref="MindmapDocumentService"/> over a throwaway temp
/// database, and cleans up the file (plus WAL sidecars) on dispose.
/// </summary>
internal sealed class MindmapTestHarness : IAsyncDisposable
{
    private readonly string _dbPath;

    public MindmapStore Store { get; }

    public MindmapDocumentService Service { get; }

    public MindmapTestHarness(MindmapShortIdGenerator? idGenerator = null)
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_mm_{Guid.NewGuid():N}.db");
        Store = new MindmapStore(new TestLogger(), _dbPath);
        Service = new MindmapDocumentService(Store, new TestLogger(), idGenerator);
    }

    public async ValueTask DisposeAsync()
    {
        await Store.DisposeAsync();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_dbPath + suffix); }
            catch { /* best effort */ }
        }
    }
}
