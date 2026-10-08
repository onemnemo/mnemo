using Mnemo.Core.Models;

namespace Mnemo.Host.Notes;

/// <summary>Turns what the user picked to export into the full set of notes that has to go with it.</summary>
public static class NoteExportScope
{
    /// <summary>
    /// The picked notes, every note in the picked folders' subtrees, and every child page under any
    /// of those, at any depth. A child page lives inside its parent note, so leaving it out would
    /// ship a note with a hole in it. Ids that name nothing are dropped; the order is stable.
    /// </summary>
    public static IReadOnlyList<string> Expand(
        IReadOnlyList<NoteSummary> notes,
        IReadOnlyList<NoteFolder> folders,
        IEnumerable<string> noteIds,
        IEnumerable<string> folderIds)
    {
        var subtree = new HashSet<string>(StringComparer.Ordinal);
        var childFolders = folders
            .Where(f => !string.IsNullOrWhiteSpace(f.ParentId))
            .ToLookup(f => f.ParentId!, StringComparer.Ordinal);
        var pendingFolders = new Stack<string>(folderIds);
        while (pendingFolders.Count > 0)
        {
            var id = pendingFolders.Pop();
            if (!subtree.Add(id))
                continue;
            foreach (var child in childFolders[id])
                pendingFolders.Push(child.FolderId);
        }

        var known = notes.Select(n => n.NoteId).ToHashSet(StringComparer.Ordinal);
        var picked = noteIds.Where(known.Contains)
            .Concat(notes.Where(n => n.FolderId is { } folder && subtree.Contains(folder)).Select(n => n.NoteId));

        var childPages = notes
            .Where(n => !string.IsNullOrWhiteSpace(n.ParentNoteId))
            .ToLookup(n => n.ParentNoteId!, StringComparer.Ordinal);
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var pendingNotes = new Stack<string>(picked.Reverse());
        while (pendingNotes.Count > 0)
        {
            var id = pendingNotes.Pop();
            if (!seen.Add(id))
                continue;
            result.Add(id);
            foreach (var child in childPages[id])
                pendingNotes.Push(child.NoteId);
        }

        return result;
    }
}
