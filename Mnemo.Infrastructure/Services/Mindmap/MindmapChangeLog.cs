using System.Collections.Generic;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// A bounded, in-memory record of which element/edge ids each recent revision touched, per map. It backs
/// the server-side rebase of non-contending edit batches: a batch arriving with a stale revision
/// can still apply cleanly if nothing it references was changed since. The log is never persisted and is
/// kept small (a fixed window per map). This is the service-side window for headless
/// edits; the open editor session keeps its own equivalent.
/// </summary>
internal sealed class MindmapChangeLog
{
    /// <summary>Revisions retained per map. Older entries fall out of the window and force a conflict.</summary>
    private const int WindowPerMap = 128;

    private readonly object _gate = new();
    private readonly Dictionary<string, LinkedList<Entry>> _byMap = new();

    private readonly record struct Entry(long Revision, IReadOnlySet<string> TouchedIds);

    /// <summary>Records the ids a committed revision touched (created, modified or deleted).</summary>
    public void Record(string mapId, long revision, IReadOnlySet<string> touchedIds)
    {
        lock (_gate)
        {
            if (!_byMap.TryGetValue(mapId, out var list))
            {
                list = new LinkedList<Entry>();
                _byMap[mapId] = list;
            }

            list.AddLast(new Entry(revision, touchedIds));
            while (list.Count > WindowPerMap)
                list.RemoveFirst();
        }
    }

    /// <summary>
    /// The union of ids touched by every revision strictly after <paramref name="sinceRevision"/>, or
    /// null when the window cannot cover that range (older than what is retained) — in which case the
    /// caller must treat the batch as a conflict, since non-contention cannot be proven.
    /// </summary>
    public IReadOnlySet<string>? TouchedSince(string mapId, long sinceRevision)
    {
        lock (_gate)
        {
            if (!_byMap.TryGetValue(mapId, out var list) || list.Count == 0)
                return null;

            // Entries are contiguous (every commit records one); a gap above sinceRevision means we lack
            // the history needed to prove the batch does not contend.
            if (list.First!.Value.Revision > sinceRevision + 1)
                return null;

            var union = new HashSet<string>();
            foreach (var entry in list)
            {
                if (entry.Revision > sinceRevision)
                    union.UnionWith(entry.TouchedIds);
            }

            return union;
        }
    }

    /// <summary>Drops a map's history (on delete).</summary>
    public void Forget(string mapId)
    {
        lock (_gate)
        {
            _byMap.Remove(mapId);
        }
    }
}
