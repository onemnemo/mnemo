using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Services.Notes;

internal static class NoteDocumentHelper
{
    public static string GetPlainText(Note note)
    {
        EnsureBlocks(note);
        if (note.Blocks is { Count: > 0 })
        {
            foreach (var b in note.Blocks)
                b.EnsureSpans();
            return string.Join("\n\n", note.Blocks.OrderBy(b => b.Order).Select(b =>
                b.Type == BlockType.Page && b.Payload is PagePayload pp
                    ? "[[" + "page:" + pp.ReferenceNoteId + "]]"
                    : b.Content));
        }

        return note.Content ?? string.Empty;
    }

    /// <summary>Ensures <see cref="Note.Blocks"/> is populated from legacy <see cref="Note.Content"/> or markdown when needed.</summary>
    public static void EnsureBlocks(Note note)
    {
        if (note.Blocks is { Count: > 0 })
        {
            NormalizeOrders(note.Blocks);
            return;
        }

        var raw = note.Content ?? string.Empty;
        if (string.IsNullOrEmpty(raw))
        {
            note.Blocks = [];
            return;
        }

        var parsed = NoteBlockMarkdownConverter.Deserialize(raw);
        if (parsed.Count > 0)
            note.Blocks = parsed;
        else
        {
            note.Blocks =
            [
                new Block
                {
                    Id = Guid.NewGuid().ToString(),
                    Type = BlockType.Text,
                    Spans = new List<InlineSpan> { InlineSpan.Plain(raw) },
                    Order = 0
                }
            ];
        }

        note.Content = string.Empty;
        NormalizeOrders(note.Blocks);
    }

    /// <summary>
    /// Sorts by <see cref="Block.Order"/> and rewrites the orders to 0..n. The sort is stable and
    /// ties keep their list position: the web editor writes the list in document order, and a
    /// note it saved before it wrote positions carries the same order on every block, which an
    /// id tie-break used to shuffle into a sequence nobody wrote.
    /// </summary>
    public static void NormalizeOrders(List<Block> blocks)
    {
        var ordered = blocks.OrderBy(b => b.Order).ToList();
        for (var i = 0; i < ordered.Count; i++)
            ordered[i].Order = i;
        blocks.Clear();
        blocks.AddRange(ordered);
    }

    public static object BlockToDto(Block b)
    {
        b.EnsureSpans();
        return new
        {
            block_id = b.Id,
            type = b.Type.ToString(),
            content = b.Content,
            order = b.Order,
            meta = b.Meta.Count > 0 ? b.Meta : null
        };
    }
}
