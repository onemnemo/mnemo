using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Persistence;

namespace Mnemo.Infrastructure.Services;

public class NoteFolderService : INoteFolderService
{
    private readonly IStorageProvider _storage;
    private readonly INoteFolderStore _folders;
    private readonly INoteTrashStore _trash;
    private const string IndexKey = "note_folders_index";

    public NoteFolderService(IStorageProvider storage, INoteFolderStore folders, INoteTrashStore trash)
    {
        _storage = storage;
        _folders = folders;
        _trash = trash;
    }

    public async Task<IEnumerable<NoteFolder>> GetAllFoldersAsync()
    {
        var indexResult = await _storage.LoadAsync<List<string>>(IndexKey);
        if (!indexResult.IsSuccess || indexResult.Value == null)
            return Enumerable.Empty<NoteFolder>();

        var held = await _trash.HeldFolderIdsAsync();

        var folders = new List<NoteFolder>();
        foreach (var id in indexResult.Value)
        {
            if (held.ContainsKey(id))
                continue;

            var folderResult = await _storage.LoadAsync<NoteFolder>($"note_folder_{id}");
            if (folderResult.IsSuccess && folderResult.Value != null)
                folders.Add(folderResult.Value);
        }

        return folders.OrderBy(f => f.Order).ThenBy(f => f.Name);
    }

    public async Task<NoteFolder?> GetFolderAsync(string folderId)
    {
        var held = await _trash.HeldFolderIdsAsync();
        if (held.ContainsKey(folderId))
            return null;

        var result = await _storage.LoadAsync<NoteFolder>($"note_folder_{folderId}");
        return result.IsSuccess ? result.Value : null;
    }

    // Writes go through the note writer rather than the key/value provider, so the folder row and the
    // index it appears in land in one transaction and a write to a folder the trash holds can be
    // refused against the same view of the data it is checked against.
    public async Task<Result> SaveFolderAsync(NoteFolder folder)
    {
        var saved = await _folders.SaveFolderAsync(folder);
        return saved
            ? Result.Success()
            : Result.Failure($"Folder {folder.FolderId} could not be saved.");
    }

    public async Task<Result> DeleteFolderAsync(string folderId)
    {
        var deleted = await _folders.DeleteFolderAsync(folderId);
        return deleted
            ? Result.Success()
            : Result.Failure($"Folder {folderId} could not be deleted.");
    }
}
