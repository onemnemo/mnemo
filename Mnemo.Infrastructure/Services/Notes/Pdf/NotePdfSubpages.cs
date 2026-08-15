using System.Collections.Generic;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// Finds the notes a document's sub-page blocks point at.
/// </summary>
/// <remarks>
/// A sub-page block stores only the referenced note's id; the title shown in the editor is looked up
/// on every render. A PDF has to print that title rather than a link, and the composer runs
/// synchronously over a single note, so whoever can read the corpus resolves the titles up front and
/// hands them to <see cref="Mnemo.Core.Services.NotePdfExportOptions.SubpageTitlesById"/>.
/// </remarks>
public static class NotePdfSubpages
{
    /// <summary>Referenced note ids, in document order, deduplicated. Empty when there are none.</summary>
    public static IReadOnlyList<string> CollectReferencedNoteIds(Note note)
    {
        var ids = new List<string>();
        var seen = new HashSet<string>(System.StringComparer.Ordinal);
        Walk(NoteTypstDocumentComposer.GetOrderedBlocksForExport(note), ids, seen);
        return ids;
    }

    private static void Walk(IReadOnlyList<Block> blocks, List<string> ids, HashSet<string> seen)
    {
        foreach (var block in blocks)
        {
            if (block.Type == BlockType.Page
                && block.Payload is PagePayload page
                && !string.IsNullOrWhiteSpace(page.ReferenceNoteId)
                && seen.Add(page.ReferenceNoteId))
            {
                ids.Add(page.ReferenceNoteId);
            }

            if (block.Children is { Count: > 0 } children)
                Walk(children, ids, seen);
        }
    }
}
