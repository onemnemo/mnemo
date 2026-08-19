using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Persistence;

namespace Mnemo.Infrastructure.Services;

public class NoteService : INoteService
{
    private readonly IStorageProvider _storage;
    private readonly INoteCommitStore _commits;
    private readonly INoteTrashStore _trash;
    private const string IndexKey = "notes_index";

    public NoteService(IStorageProvider storage, INoteCommitStore commits, INoteTrashStore trash)
    {
        _storage = storage;
        _commits = commits;
        _trash = trash;
    }

    // A note the trash holds stays in the index, because the asset sweep reads that index to decide
    // which images are still spoken for. It is filtered out here instead, which is the one place the
    // library is assembled and so the one place "deleted" has to mean invisible.
    public async Task<IEnumerable<Note>> GetAllNotesAsync()
    {
        var indexResult = await _storage.LoadAsync<List<string>>(IndexKey);
        if (!indexResult.IsSuccess || indexResult.Value == null)
            return Enumerable.Empty<Note>();

        var held = await _trash.HeldNoteIdsAsync();

        var notes = new List<Note>();
        foreach (var id in indexResult.Value)
        {
            if (held.ContainsKey(id))
                continue;

            var noteResult = await _storage.LoadAsync<Note>($"note_{id}");
            if (noteResult.IsSuccess && noteResult.Value != null)
                notes.Add(noteResult.Value);
        }

        return notes.OrderByDescending(n => n.ModifiedAt);
    }

    public async Task<Note?> GetNoteAsync(string noteId)
    {
        var held = await _trash.HeldNoteIdsAsync();
        if (held.ContainsKey(noteId))
            return null;

        var result = await _storage.LoadAsync<Note>($"note_{noteId}");
        return result.IsSuccess ? result.Value : null;
    }

    // Both writes go through the commit store rather than the key/value provider, so the note and
    // the index it appears in land in one transaction. Written separately, a crash in between left
    // a note that existed but could not be listed, or an index entry pointing at nothing.
    public async Task<Result> SaveNoteAsync(Note note)
    {
        try
        {
            var result = await _commits.PutAsync(note);
            // The one way this write is refused is a note the trash is holding. Reporting success
            // would leave a caller, an import in particular, believing it wrote something it did not.
            return result.Outcome == NoteCommitOutcome.Applied
                ? Result.Success()
                : Result.Failure($"Note {note.NoteId} is in the trash and cannot be written to.");
        }
        catch (Exception ex)
        {
            return Result.Failure($"Failed to save note {note.NoteId}.", ex);
        }
    }

    public async Task<Result> DeleteNoteAsync(string noteId)
    {
        try
        {
            await _commits.DeleteAsync(noteId);
            return Result.Success();
        }
        catch (Exception ex)
        {
            return Result.Failure($"Failed to delete note {noteId}.", ex);
        }
    }
}
