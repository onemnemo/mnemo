using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

public class NoteService : INoteService
{
    private readonly IStorageProvider _storage;
    private readonly INoteCommitStore _commits;
    private const string IndexKey = "notes_index";

    public NoteService(IStorageProvider storage, INoteCommitStore commits)
    {
        _storage = storage;
        _commits = commits;
    }

    public async Task<IEnumerable<Note>> GetAllNotesAsync()
    {
        var indexResult = await _storage.LoadAsync<List<string>>(IndexKey);
        if (!indexResult.IsSuccess || indexResult.Value == null)
            return Enumerable.Empty<Note>();

        var notes = new List<Note>();
        foreach (var id in indexResult.Value)
        {
            var noteResult = await _storage.LoadAsync<Note>($"note_{id}");
            if (noteResult.IsSuccess && noteResult.Value != null)
                notes.Add(noteResult.Value);
        }

        return notes.OrderByDescending(n => n.ModifiedAt);
    }

    public async Task<Note?> GetNoteAsync(string noteId)
    {
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
            await _commits.PutAsync(note);
            return Result.Success();
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
