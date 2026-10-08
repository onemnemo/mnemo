namespace Mnemo.Host.Transfer;

/// <summary>Resolves the folders an export names into every folder beneath them.</summary>
public static class FolderSubtree
{
    /// <summary>
    /// <paramref name="roots"/> and every folder under them. Roots that name no folder are kept, so
    /// the caller can still refuse them; a parent loop is walked once.
    /// </summary>
    public static HashSet<string> Of<T>(
        IEnumerable<T> folders,
        Func<T, string> idOf,
        Func<T, string?> parentOf,
        IEnumerable<string> roots)
    {
        var children = folders
            .Where(f => !string.IsNullOrWhiteSpace(parentOf(f)))
            .ToLookup(f => parentOf(f)!, StringComparer.Ordinal);
        var subtree = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Stack<string>(roots);
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
}
