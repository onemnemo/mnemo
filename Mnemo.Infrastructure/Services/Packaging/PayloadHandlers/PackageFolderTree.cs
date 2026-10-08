namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// The folder walks every package payload shares: what a folder export carries, and the order an
/// import has to write folders in. Works on any folder shape through id and parent selectors.
/// </summary>
internal static class PackageFolderTree
{
    /// <summary>
    /// Every folder under <paramref name="roots"/>, the roots included and empty folders too. Ids that
    /// name no folder are ignored, and a parent loop is walked once.
    /// </summary>
    public static HashSet<string> Subtree<T>(
        IReadOnlyList<T> all,
        Func<T, string> idOf,
        Func<T, string?> parentOf,
        IEnumerable<string> roots)
    {
        var children = all
            .Where(f => !string.IsNullOrWhiteSpace(parentOf(f)))
            .ToLookup(f => parentOf(f)!, StringComparer.Ordinal);
        var known = new HashSet<string>(all.Select(idOf), StringComparer.Ordinal);

        var subtree = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Stack<string>(roots.Where(known.Contains));
        while (pending.Count > 0)
        {
            var id = pending.Pop();
            if (!subtree.Add(id))
                continue;
            foreach (var child in children[id])
                pending.Push(idOf(child));
        }

        return subtree;
    }

    /// <summary>
    /// The package's folders with every parent ahead of its children. A folder is a root when its
    /// parent is not in the package, or when its parent chain loops back on itself, which only a
    /// damaged package can hold; the loop is broken at the folder where it was found.
    /// </summary>
    public static List<(T Folder, bool IsRoot)> ParentFirst<T>(
        IReadOnlyList<T> folders,
        Func<T, string> idOf,
        Func<T, string?> parentOf)
    {
        var byId = new Dictionary<string, T>(StringComparer.Ordinal);
        foreach (var folder in folders)
            byId.TryAdd(idOf(folder), folder);

        var ordered = new List<(T, bool)>(byId.Count);
        var placed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var folder in byId.Values)
        {
            if (placed.Contains(idOf(folder)))
                continue;

            // Climb to the first ancestor already placed or outside the package, then place the chain
            // top down. Meeting a folder twice on one climb is a loop.
            var chain = new List<T>();
            var onChain = new HashSet<string>(StringComparer.Ordinal);
            var current = folder;
            var brokenLoop = false;
            while (true)
            {
                chain.Add(current);
                onChain.Add(idOf(current));
                var parentId = parentOf(current);
                if (string.IsNullOrWhiteSpace(parentId)
                    || placed.Contains(parentId)
                    || !byId.TryGetValue(parentId, out var parent))
                    break;
                if (onChain.Contains(parentId))
                {
                    brokenLoop = true;
                    break;
                }
                current = parent;
            }

            for (var i = chain.Count - 1; i >= 0; i--)
            {
                var item = chain[i];
                var parentId = parentOf(item);
                var inPackage = !string.IsNullOrWhiteSpace(parentId) && byId.ContainsKey(parentId);
                ordered.Add((item, i == chain.Count - 1 && (brokenLoop || !inPackage)));
                placed.Add(idOf(item));
            }
        }

        return ordered;
    }
}
