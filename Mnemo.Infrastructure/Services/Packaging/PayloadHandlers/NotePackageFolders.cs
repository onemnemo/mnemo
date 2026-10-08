using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>Which folders a notes package carries, and the order an import has to write them in.</summary>
internal static class NotePackageFolders
{
    /// <summary>
    /// The folders an export narrowed to <paramref name="notes"/> carries: each folder that holds one
    /// of them, plus every folder under <paramref name="subtreeRoots"/>, empty ones included, so a
    /// nested folder keeps its shape. Ids that name no folder are ignored.
    /// </summary>
    public static List<NoteFolder> ForExport(
        IReadOnlyList<NoteFolder> all,
        IEnumerable<Note> notes,
        IEnumerable<string> subtreeRoots)
    {
        var keep = new HashSet<string>(
            notes.Where(n => !string.IsNullOrWhiteSpace(n.FolderId)).Select(n => n.FolderId!),
            StringComparer.Ordinal);

        var children = all
            .Where(f => !string.IsNullOrWhiteSpace(f.ParentId))
            .ToLookup(f => f.ParentId!, StringComparer.Ordinal);
        var known = new HashSet<string>(all.Select(f => f.FolderId), StringComparer.Ordinal);

        var pending = new Stack<string>(subtreeRoots.Where(known.Contains));
        var visited = new HashSet<string>(StringComparer.Ordinal);
        while (pending.Count > 0)
        {
            var id = pending.Pop();
            if (!visited.Add(id))
                continue;
            keep.Add(id);
            foreach (var child in children[id])
                pending.Push(child.FolderId);
        }

        return all.Where(f => keep.Contains(f.FolderId)).ToList();
    }

    /// <summary>
    /// The package's folders with every parent ahead of its children. A folder is a root when its
    /// parent is not in the package, or when its parent chain loops back on itself, which only a
    /// damaged package can hold; the loop is broken at the folder where it was found.
    /// </summary>
    public static List<(NoteFolder Folder, bool IsRoot)> ParentFirst(IReadOnlyList<NoteFolder> folders)
    {
        var byId = new Dictionary<string, NoteFolder>(StringComparer.Ordinal);
        foreach (var folder in folders)
            byId.TryAdd(folder.FolderId, folder);

        var ordered = new List<(NoteFolder, bool)>(byId.Count);
        var placed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var folder in byId.Values)
        {
            if (placed.Contains(folder.FolderId))
                continue;

            // Climb to the first ancestor already placed or outside the package, then place the chain
            // top down. Meeting a folder twice on one climb is a loop.
            var chain = new List<NoteFolder>();
            var onChain = new HashSet<string>(StringComparer.Ordinal);
            var current = folder;
            var brokenLoop = false;
            while (true)
            {
                chain.Add(current);
                onChain.Add(current.FolderId);
                if (string.IsNullOrWhiteSpace(current.ParentId)
                    || placed.Contains(current.ParentId)
                    || !byId.TryGetValue(current.ParentId, out var parent))
                    break;
                if (onChain.Contains(parent.FolderId))
                {
                    brokenLoop = true;
                    break;
                }
                current = parent;
            }

            for (var i = chain.Count - 1; i >= 0; i--)
            {
                var item = chain[i];
                var isRoot = i == chain.Count - 1 && (brokenLoop || !IsInPackage(item.ParentId, byId));
                ordered.Add((item, isRoot));
                placed.Add(item.FolderId);
            }
        }

        return ordered;
    }

    private static bool IsInPackage(string? parentId, Dictionary<string, NoteFolder> byId) =>
        !string.IsNullOrWhiteSpace(parentId) && byId.ContainsKey(parentId);
}
