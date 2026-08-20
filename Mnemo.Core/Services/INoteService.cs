using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Service for loading and persisting notes.
/// </summary>
public interface INoteService
{
    /// <summary>
    /// Gets all notes.
    /// </summary>
    Task<IEnumerable<Note>> GetAllNotesAsync();

    /// <summary>
    /// Gets all notes without their bodies, in the same order <see cref="GetAllNotesAsync"/> returns
    /// them: newest modified first, with anything the trash holds left out.
    /// <para>
    /// This is the one to call to list the library. It answers the same question about the same notes
    /// while leaving every body in storage, and a caller that reads no block should not be paying to
    /// parse one.
    /// </para>
    /// </summary>
    Task<IReadOnlyList<NoteSummary>> GetAllNoteSummariesAsync();

    /// <summary>
    /// Gets a note by id.
    /// </summary>
    Task<Note?> GetNoteAsync(string noteId);

    /// <summary>
    /// Saves a note (create or update).
    /// </summary>
    Task<Result> SaveNoteAsync(Note note);

    /// <summary>
    /// Deletes a note by id.
    /// </summary>
    Task<Result> DeleteNoteAsync(string noteId);
}
