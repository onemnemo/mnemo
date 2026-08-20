using Mnemo.Core.Models;

namespace Mnemo.Host.Notes;

/// <summary>
/// Placement rules for the notes tree: where a new item goes, what a note's folder
/// path reads as, and which reparents would close a loop. Shared by the note and
/// folder endpoints so both answer these the same way.
/// </summary>
internal static class NoteTree
{
    /// <summary>Separator between folder names in <see cref="Note.FolderPath"/>.</summary>
    private const string PathSeparator = " / ";

    /// <summary>
    /// Depth ceiling for every walk up the tree. Nesting is unbounded by design, so the
    /// cap is not a rule about how deep a tree may be; it stops a walk that a corrupt
    /// or hand-edited parent chain would otherwise run forever.
    /// </summary>
    private const int MaxWalkDepth = 512;

    /// <summary>
    /// The stored breadcrumb for a note in the given folder: ancestor names from the
    /// root down, joined with " / ". Root-level notes get the empty string.
    /// </summary>
    public static string BuildFolderPath(IReadOnlyCollection<NoteFolder> folders, string? folderId)
    {
        if (string.IsNullOrEmpty(folderId))
            return string.Empty;

        var byId = folders.ToDictionary(f => f.FolderId);
        var names = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var current = folderId;
        while (!string.IsNullOrEmpty(current) && seen.Add(current) && names.Count < MaxWalkDepth)
        {
            if (!byId.TryGetValue(current, out var folder))
                break;
            names.Add(folder.Name);
            current = folder.ParentId;
        }

        names.Reverse();
        return string.Join(PathSeparator, names);
    }

    /// <summary>Appends after the last note in a folder.</summary>
    public static int NextNoteOrder(IEnumerable<Note> notes, string? folderId)
        => notes.Where(n => SameFolder(n.FolderId, folderId)).Select(n => n.Order).DefaultIfEmpty(-1).Max() + 1;

    /// <summary>Appends after the last folder under a parent.</summary>
    public static int NextFolderOrder(IEnumerable<NoteFolder> folders, string? parentId)
        => folders.Where(f => SameFolder(f.ParentId, parentId)).Select(f => f.Order).DefaultIfEmpty(-1).Max() + 1;

    /// <summary>
    /// True when <paramref name="candidateId"/> is <paramref name="folderId"/> itself or
    /// sits underneath it: the two ways moving a folder there would detach the subtree
    /// from the root into a loop.
    /// </summary>
    public static bool IsSelfOrDescendant(IReadOnlyCollection<NoteFolder> folders, string folderId, string? candidateId)
    {
        if (string.IsNullOrEmpty(candidateId))
            return false;

        var byId = folders.ToDictionary(f => f.FolderId);
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var current = candidateId;
        while (!string.IsNullOrEmpty(current) && seen.Add(current) && seen.Count <= MaxWalkDepth)
        {
            if (string.Equals(current, folderId, StringComparison.Ordinal))
                return true;
            if (!byId.TryGetValue(current, out var folder))
                break;
            current = folder.ParentId;
        }

        return false;
    }

    /// <summary>Null and empty both mean the root, and a client may send either.</summary>
    private static bool SameFolder(string? left, string? right)
        => string.Equals(
            string.IsNullOrEmpty(left) ? null : left,
            string.IsNullOrEmpty(right) ? null : right,
            StringComparison.Ordinal);
}
