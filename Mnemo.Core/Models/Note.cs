using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models;

/// <summary>
/// Represents a single note with metadata and content.
/// </summary>
public class Note
{
    /// <summary>
    /// Unique identifier for the note.
    /// </summary>
    public string NoteId { get; set; } = Guid.NewGuid().ToString();

    /// <summary>
    /// Short, corpus-unique identifier. This is the note id that crosses the model and tool
    /// boundary; <see cref="NoteId"/> stays internal because it is the durable storage key.
    /// Empty until the sid migration has run over this note.
    /// </summary>
    public string Sid { get; set; } = string.Empty;

    /// <summary>
    /// Monotonic revision counter, incremented once per converged logical document change. Content
    /// writes compare against it and swap, so it is what makes a stale write fail instead of
    /// clobbering. It must never decrease — not even when content is restored to an earlier state,
    /// because an old edit token would then become valid again for different content.
    /// Zero means the note predates the migration.
    /// </summary>
    public long Ver { get; set; }

    /// <summary>
    /// Display title of the note.
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Id of the folder containing this note, or null for root.
    /// </summary>
    public string? FolderId { get; set; }

    /// <summary>
    /// When set, this note was created as a child page of another note (e.g. from a page block). Does not replace folder hierarchy.
    /// </summary>
    public string? ParentNoteId { get; set; }

    /// <summary>
    /// Display order among siblings in the same folder (lower = first). Used for drag-reorder.
    /// </summary>
    public int Order { get; set; }

    /// <summary>
    /// Folder path for hierarchy and breadcrumb (e.g. "Folder / Subfolder"). Can be derived from folder tree.
    /// </summary>
    public string FolderPath { get; set; } = string.Empty;

    /// <summary>
    /// Raw content (legacy/markdown). When <see cref="Blocks"/> is present it is used for editing; Content can be synced for export.
    /// </summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>
    /// Block-based content for the editor. When null or empty, editor uses a single text block from <see cref="Content"/>.
    /// </summary>
    public List<Block>? Blocks { get; set; }

    /// <summary>
    /// When the note was created.
    /// </summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// When the note was last modified.
    /// </summary>
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Whether the note is marked as a favorite (shown in Favourites in the sidebar).
    /// </summary>
    public bool IsFavorite { get; set; }

    /// <summary>
    /// Optional page icon, a single emoji shown over the title and in the tree. Null when the
    /// note carries the neutral file mark instead.
    /// </summary>
    public string? Emoji { get; set; }

    /// <summary>
    /// Optional cover token for the banner drawn above the title: one of the preset names, or
    /// <c>asset:{assetId}</c> for an image the user uploaded. Null for a note with no cover.
    /// Stored as an opaque token so the token set can change without rewriting saved notes, and
    /// a reader that does not know a token draws no cover instead of a broken banner.
    /// <para>
    /// Any value here that names a file must also be collected by the asset sweep's reference
    /// source (Mnemo.Host NoteAssetReferenceSource), or the file counts as an orphan and is
    /// deleted out from under the note.
    /// </para>
    /// </summary>
    public string? Cover { get; set; }

    /// <summary>
    /// Page tags shown as chips under the title. Plain labels; the chip colour is derived from
    /// the label so the same tag reads the same everywhere without storing a colour.
    /// </summary>
    public List<string> Tags { get; set; } = new();
}
