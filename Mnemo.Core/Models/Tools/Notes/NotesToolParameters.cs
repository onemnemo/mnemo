using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Mnemo.Core.Models.Tools.Notes;

/// <summary>
/// A block to create. Used by <c>create_note</c> and the <c>insert</c>/<c>replace</c> edit ops.
/// </summary>
/// <remarks>
/// Most blocks only need <see cref="Type"/> + <see cref="Markdown"/>. The typed fields
/// (<see cref="Latex"/>, <see cref="Language"/>, <see cref="Checked"/>) carry the payload for
/// equation, code, and checklist blocks. <see cref="Children"/> nests blocks (e.g. two-column).
/// </remarks>
public sealed class NoteBlockSpec
{
    /// <summary>Block type: Text, Heading1-4, BulletList, NumberedList, Checklist, Quote, Code, Divider, Equation, Page.</summary>
    [JsonPropertyName("type")] public string Type { get; set; } = "Text";

    /// <summary>Inline markdown for the block body (bold, italic, links, inline math). Ignored for Equation/Code.</summary>
    [JsonPropertyName("markdown")] public string? Markdown { get; set; }

    /// <summary>LaTeX source for an Equation block.</summary>
    [JsonPropertyName("latex")] public string? Latex { get; set; }

    /// <summary>Language for a Code block (defaults to plain text).</summary>
    [JsonPropertyName("language")] public string? Language { get; set; }

    /// <summary>Initial checked state for a Checklist block.</summary>
    [JsonPropertyName("checked")] public bool? Checked { get; set; }

    /// <summary>Nested blocks (used for layout blocks such as two-column).</summary>
    [JsonPropertyName("children")] public List<NoteBlockSpec>? Children { get; set; }
}

/// <summary>Parameters for <c>search_notes</c>: discovery and block-level search.</summary>
public sealed class SearchNotesParameters
{
    /// <summary>Keywords. When omitted, lists notes (optionally filtered) newest-first.</summary>
    [JsonPropertyName("query")] public string? Query { get; set; }

    /// <summary>Restrict to a folder id or folder name.</summary>
    [JsonPropertyName("folder")] public string? Folder { get; set; }

    /// <summary>When true, only favorite notes.</summary>
    [JsonPropertyName("favorite")] public bool? Favorite { get; set; }

    /// <summary>Max results (default 10, max 50).</summary>
    [JsonPropertyName("limit")] public int? Limit { get; set; }

    /// <summary>When true, every keyword must match (AND). Default false (OR).</summary>
    [JsonPropertyName("match_all")] public bool? MatchAll { get; set; }

    /// <summary>When true (default), typo-tolerant word matching.</summary>
    [JsonPropertyName("fuzzy")] public bool? Fuzzy { get; set; }
}

/// <summary>Parameters for <c>outline_note</c>: a compact structural map of a note.</summary>
public sealed class OutlineNoteParameters
{
    /// <summary>The note's short id, as returned by search_notes, outline_note, or create_note. The note's GUID is also accepted.</summary>
    [JsonPropertyName("note_id")] public string NoteId { get; set; } = string.Empty;

    /// <summary>When true, only heading blocks are returned.</summary>
    [JsonPropertyName("headings_only")] public bool? HeadingsOnly { get; set; }

    /// <summary>Preview length per block in characters (default 60).</summary>
    [JsonPropertyName("preview_chars")] public int? PreviewChars { get; set; }
}

/// <summary>Parameters for <c>read_note</c>: a lossless read of specific parts of a note.</summary>
public sealed class ReadNoteParameters
{
    /// <summary>The note's short id, as returned by search_notes, outline_note, or create_note. The note's GUID is also accepted.</summary>
    [JsonPropertyName("note_id")] public string NoteId { get; set; } = string.Empty;

    /// <summary>Read only these blocks (short block ids from outline_note or read_note).</summary>
    [JsonPropertyName("block_ids")] public List<string>? BlockIds { get; set; }

    /// <summary>Read a heading block and everything under it until the next same/higher heading.</summary>
    [JsonPropertyName("section")] public string? Section { get; set; }

    /// <summary>1-based start of a top-level block window.</summary>
    [JsonPropertyName("from")] public int? From { get; set; }

    /// <summary>1-based inclusive end of a top-level block window.</summary>
    [JsonPropertyName("to")] public int? To { get; set; }
}

/// <summary>One operation in an <c>edit_note</c> batch. The <see cref="Op"/> field selects the action.</summary>
/// <remarks>
/// Supported ops: <c>set_text</c> (replace a block's inline text), <c>replace</c> (replace a whole
/// block), <c>insert</c> (add blocks at an anchor), <c>delete</c>, <c>move</c>, <c>convert</c>
/// (change block type), <c>set_checked</c>. Targets are addressed by the short block id.
/// </remarks>
public sealed class NoteEditOp
{
    [JsonPropertyName("op")] public string Op { get; set; } = string.Empty;

    /// <summary>Target block's short id for set_text, replace, convert, set_checked, move.</summary>
    [JsonPropertyName("id")] public string? Id { get; set; }

    /// <summary>Target blocks' short ids for delete.</summary>
    [JsonPropertyName("ids")] public List<string>? Ids { get; set; }

    /// <summary>Inline markdown for set_text and single-block replace/insert.</summary>
    [JsonPropertyName("markdown")] public string? Markdown { get; set; }

    /// <summary>Block type for replace, convert, and single-block insert.</summary>
    [JsonPropertyName("type")] public string? Type { get; set; }

    /// <summary>LaTeX for an Equation block (replace/insert/set_text on equations).</summary>
    [JsonPropertyName("latex")] public string? Latex { get; set; }

    /// <summary>Language for a Code block.</summary>
    [JsonPropertyName("language")] public string? Language { get; set; }

    /// <summary>Checked state for set_checked.</summary>
    [JsonPropertyName("checked")] public bool? Checked { get; set; }

    /// <summary>Anchor block's short id for insert and move.</summary>
    [JsonPropertyName("anchor")] public string? Anchor { get; set; }

    /// <summary>Placement relative to the anchor: before, after, start, end. Default end (top of doc has start).</summary>
    [JsonPropertyName("position")] public string? Position { get; set; }

    /// <summary>Blocks to insert (preferred over the single-block markdown/type fields).</summary>
    [JsonPropertyName("blocks")] public List<NoteBlockSpec>? Blocks { get; set; }
}

/// <summary>Parameters for <c>edit_note</c>: an atomic batch of block operations.</summary>
public sealed class EditNoteParameters
{
    /// <summary>The note's short id, as returned by search_notes, outline_note, or create_note. The note's GUID is also accepted.</summary>
    [JsonPropertyName("note_id")] public string NoteId { get; set; } = string.Empty;

    /// <summary>Optional version token from outline/read; the edit is rejected if the note changed since.</summary>
    [JsonPropertyName("expected_version")] public string? ExpectedVersion { get; set; }

    /// <summary>Operations applied in order. All-or-nothing: any failure aborts the whole batch.</summary>
    [JsonPropertyName("ops")] public List<NoteEditOp> Ops { get; set; } = [];
}

/// <summary>Parameters for <c>create_note</c>.</summary>
public sealed class CreateNoteParameters
{
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;

    /// <summary>Folder id or name to file the note under.</summary>
    [JsonPropertyName("folder")] public string? Folder { get; set; }

    /// <summary>Mark the new note as a favorite.</summary>
    [JsonPropertyName("favorite")] public bool? Favorite { get; set; }

    /// <summary>Initial body as markdown (converted to blocks).</summary>
    [JsonPropertyName("markdown")] public string? Markdown { get; set; }

    /// <summary>Initial body as structured blocks (preferred over markdown for rich content).</summary>
    [JsonPropertyName("blocks")] public List<NoteBlockSpec>? Blocks { get; set; }
}

/// <summary>Parameters for <c>manage_note</c>: rename, move, favorite, or delete a note.</summary>
public sealed class ManageNoteParameters
{
    /// <summary>The note's short id, as returned by search_notes, outline_note, or create_note. The note's GUID is also accepted.</summary>
    [JsonPropertyName("note_id")] public string NoteId { get; set; } = string.Empty;

    /// <summary>New title.</summary>
    [JsonPropertyName("rename")] public string? Rename { get; set; }

    /// <summary>Move into this folder (id or name).</summary>
    [JsonPropertyName("move_to_folder")] public string? MoveToFolder { get; set; }

    /// <summary>Move the note to the root (no folder).</summary>
    [JsonPropertyName("clear_folder")] public bool? ClearFolder { get; set; }

    /// <summary>Set or clear the favorite flag.</summary>
    [JsonPropertyName("favorite")] public bool? Favorite { get; set; }

    /// <summary>When true, permanently deletes the note.</summary>
    [JsonPropertyName("delete")] public bool? Delete { get; set; }
}

/// <summary>Parameters for <c>open_note</c>.</summary>
public sealed class OpenNoteParameters
{
    /// <summary>The note's short id, as returned by search_notes, outline_note, or create_note. The note's GUID is also accepted.</summary>
    [JsonPropertyName("note_id")] public string NoteId { get; set; } = string.Empty;
}
