using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Services.Trash;
using Mnemo.Infrastructure.Tests.Flashcards;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Trash;

/// <summary>
/// A trash coordinator over a throwaway database, with two fake modules wired to it.
/// </summary>
internal sealed class TrashTestHarness : IAsyncDisposable
{
    /// <summary>The kind the first fake module owns.</summary>
    public const string NoteKind = "note";

    /// <summary>The kind the second fake module owns.</summary>
    public const string DeckKind = "deck";

    private readonly string _dbPath;

    /// <param name="now">The instant the coordinator stamps deletions with.</param>
    public TrashTestHarness(DateTimeOffset? now = null)
    {
        Time = new TestTimeProvider(now ?? DateTimeOffset.UtcNow);
        _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_trash_{Guid.NewGuid():N}.db");
        Database = new TrashDatabase(new TestLogger(), _dbPath);
        Store = new TrashStore(Database);
        CleanupStore = new AssetCleanupStore(Database);
        Notes = new FakeTrashSource(NoteKind);
        Decks = new FakeTrashSource(DeckKind);
        Maintenance = new RecordingTrashMaintenance();
        Service = new TrashService(
            Store,
            new TrashSourceRegistry([Notes, Decks]),
            new TestLogger(),
            Maintenance,
            Time);
    }

    /// <summary>The clock deletions are stamped from. Move it to reach an expiry.</summary>
    public TestTimeProvider Time { get; }

    /// <summary>The shared trash tables.</summary>
    public TrashDatabase Database { get; }

    /// <summary>The ledger, for planting the states a crash leaves behind.</summary>
    public TrashStore Store { get; }

    /// <summary>The queue of files waiting to be removed.</summary>
    public AssetCleanupStore CleanupStore { get; }

    /// <summary>The first fake module.</summary>
    public FakeTrashSource Notes { get; }

    /// <summary>The second fake module.</summary>
    public FakeTrashSource Decks { get; }

    /// <summary>The background passes the coordinator asked for.</summary>
    public RecordingTrashMaintenance Maintenance { get; }

    /// <summary>The coordinator under test.</summary>
    public TrashService Service { get; }

    /// <summary>Deletes one item of the first fake module's kind.</summary>
    public Task<TrashAction> DeleteNoteAsync(string itemId) =>
        Service.DeleteAsync([new TrashDeleteRequest(NoteKind, itemId)]);

    /// <summary>Every held entry, newest first.</summary>
    public async Task<IReadOnlyList<TrashEntry>> HeldAsync()
    {
        var page = await Service.ListAsync(new TrashListQuery(Limit: 100));
        return page.Entries.Select(e => e.Entry).ToList();
    }

    /// <summary>The ledger row behind an entry id, in any state.</summary>
    public Task<TrashEntry?> RowAsync(string entryId) => Store.GetAsync(entryId);

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        Service.Dispose();
        await Database.DisposeAsync();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try
            {
                File.Delete(_dbPath + suffix);
            }
            catch
            {
                // Best effort: a leftover temp file is not worth failing a test over.
            }
        }
    }
}
