using System;
using System.Collections.Generic;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Services.Notes;

/// <summary>
/// Projects blocks into compact, agent-facing JSON shapes for outline and read tools.
/// </summary>
/// <remarks>
/// Reads are lossless where it matters: flow blocks carry their inline markdown (so formatting,
/// links and inline math survive a round-trip), and typed blocks expose their payload (equation
/// LaTeX, code language/source, image, page reference, checklist state). Outlines stay tiny
/// (a single truncated preview per block), so a small model can map a note without loading it.
/// </remarks>
internal static class NotesAgentBlockMapper
{
    /// <summary>A one-line outline entry: short id, type, depth, length, and a short preview.</summary>
    public static Dictionary<string, object?> ToOutlineEntry(Block block, int ordinal, int previewChars)
    {
        block.EnsureSpans();
        var text = block.Content ?? string.Empty;
        var preview = Truncate(Collapse(text), previewChars);

        return new Dictionary<string, object?>
        {
            ["n"] = ordinal,
            ["id"] = NoteBlockTree.Handle(block),
            ["type"] = block.Type.ToString(),
            ["len"] = text.Length,
            ["preview"] = preview
        };
    }

    /// <summary>
    /// A lossless read entry with markdown plus any typed payload and nested children.
    /// </summary>
    /// <param name="noteHandle">
    /// Maps a referenced note's GUID to the handle to report for it (its sid, or the GUID unchanged
    /// when the note is unknown). Only consulted for a <see cref="BlockType.Page"/> block.
    /// </param>
    public static Dictionary<string, object?> ToReadEntry(Block block, int depth, Func<string, string> noteHandle)
    {
        block.EnsureSpans();
        var dto = new Dictionary<string, object?>
        {
            ["id"] = NoteBlockTree.Handle(block),
            ["type"] = block.Type.ToString(),
            ["order"] = block.Order,
            ["depth"] = depth
        };

        switch (block.Type)
        {
            case BlockType.Equation:
                dto["latex"] = block.Payload is EquationPayload ep ? ep.Latex : block.Content;
                break;
            case BlockType.Code:
                if (block.Payload is CodePayload cp)
                    dto["code"] = new Dictionary<string, object?> { ["language"] = cp.Language, ["source"] = cp.Source };
                else
                    dto["code"] = new Dictionary<string, object?> { ["language"] = "", ["source"] = block.Content };
                break;
            case BlockType.Image:
                if (block.Payload is ImagePayload img)
                    dto["image"] = new Dictionary<string, object?>
                    {
                        ["path"] = img.Path,
                        ["alt"] = img.Alt,
                        ["width"] = img.Width,
                        ["align"] = img.Align
                    };
                break;
            case BlockType.Page:
                var referenced = block.Payload is PagePayload pp ? pp.ReferenceNoteId : "";
                dto["page"] = new Dictionary<string, object?>
                {
                    ["reference_note_id"] = string.IsNullOrEmpty(referenced) ? referenced : noteHandle(referenced)
                };
                break;
            case BlockType.Sketch:
                dto["sketch"] = block.Content;
                break;
            case BlockType.Divider:
                break;
            default:
                dto["markdown"] = InlineMarkdownSerializer.SerializeSpans(block.Spans);
                if (block.Type == BlockType.Checklist)
                    dto["checked"] = block.Payload is ChecklistPayload chk && chk.Checked;
                if (block.Type == BlockType.Callout)
                    dto["callout"] = new Dictionary<string, object?>
                    {
                        ["emoji"] = block.Payload is CalloutPayload co ? co.Emoji : "",
                        ["tone"] = block.Payload is CalloutPayload co2 ? co2.Tone : "note"
                    };
                break;
        }

        if (block.Children is { Count: > 0 })
        {
            var children = new List<object>(block.Children.Count);
            foreach (var child in block.Children)
                children.Add(ToReadEntry(child, depth + 1, noteHandle));
            dto["children"] = children;
        }

        return dto;
    }

    private static string Collapse(string text)
    {
        if (string.IsNullOrEmpty(text))
            return string.Empty;
        var chars = text.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (chars[i] is '\n' or '\r' or '\t')
                chars[i] = ' ';
        }

        return new string(chars).Trim();
    }

    private static string Truncate(string text, int max)
    {
        if (max < 8)
            max = 8;
        return text.Length <= max ? text : text[..max] + "…";
    }
}
