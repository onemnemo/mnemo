using System;
using System.Collections.Generic;
using System.Linq;

namespace Mnemo.Core.Models;

/// <summary>
/// A note without its body: what a list of notes shows, and nothing that needs the blocks read.
/// <para>
/// It exists so listing the library can be answered without materialising every note's content. A
/// caller that only ever reads these fields is asking a much smaller question than <see cref="Note"/>
/// answers, and this type is what lets a storage layer notice that.
/// </para>
/// <para>
/// Timestamps carry the kind they were stored with, exactly as <see cref="Note"/> does, and are not
/// normalised here. Relabelling them belongs to whatever is about to present them; doing it early
/// would shift a value that was written without a kind.
/// </para>
/// </summary>
public sealed record NoteSummary(
    string NoteId,
    string Sid,
    long Ver,
    string Title,
    string? FolderId,
    string? ParentNoteId,
    int Order,
    bool IsFavorite,
    DateTime CreatedAt,
    DateTime ModifiedAt,
    string? Emoji,
    string? Cover,
    IReadOnlyList<string> Tags)
{
    /// <summary>
    /// The summary of a note already in hand. This is the definition of what the fields mean: any
    /// other way of producing a summary has to agree with it field for field.
    /// </summary>
    public static NoteSummary FromNote(Note note)
    {
        ArgumentNullException.ThrowIfNull(note);
        return new NoteSummary(
            note.NoteId,
            note.Sid,
            note.Ver,
            note.Title,
            note.FolderId,
            note.ParentNoteId,
            note.Order,
            note.IsFavorite,
            note.CreatedAt,
            note.ModifiedAt,
            note.Emoji,
            note.Cover,
            note.Tags is null ? [] : [.. note.Tags]);
    }
}
