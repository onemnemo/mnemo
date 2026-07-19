using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Notes;

/// <summary>Folder CRUD for the notes tree.</summary>
public static class NoteFolderEndpoints
{
    private const string DefaultName = "New folder";

    public static void MapNoteFolders(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/note-folders", async (INoteFolderService folders) =>
        {
            var all = await folders.GetAllFoldersAsync().ConfigureAwait(false);
            return all.Select(NoteFolderDto.FromModel).ToList();
        });

        endpoints.MapPost("/api/note-folders", async (SaveNoteFolderDto body, INoteFolderService folders) =>
        {
            var all = (await folders.GetAllFoldersAsync().ConfigureAwait(false)).ToList();
            var parentId = Blank(body.ParentId);
            if (parentId is not null && !all.Any(f => f.FolderId == parentId))
                return Results.BadRequest(new ErrorDto("unknown_folder", $"No note folder '{parentId}'."));

            var folder = new NoteFolder
            {
                Name = Blank(body.Name) ?? DefaultName,
                ParentId = parentId,
                Order = body.Order,
            };

            var saved = await folders.SaveFolderAsync(folder).ConfigureAwait(false);
            return saved.IsSuccess
                ? Results.Ok(NoteFolderDto.FromModel(folder))
                : Results.StatusCode(StatusCodes.Status500InternalServerError);
        });

        endpoints.MapPut("/api/note-folders/{id}", async (string id, SaveNoteFolderDto body, INoteFolderService folders) =>
        {
            var all = (await folders.GetAllFoldersAsync().ConfigureAwait(false)).ToList();
            var folder = all.FirstOrDefault(f => f.FolderId == id);
            if (folder is null)
                return Results.NotFound(new ErrorDto("unknown_folder", $"No note folder '{id}'."));

            var name = body.Name?.Trim();
            if (string.IsNullOrEmpty(name))
                return Results.BadRequest(new ErrorDto("invalid_name", "A folder name is required."));

            var parentId = Blank(body.ParentId);
            if (parentId is not null && !all.Any(f => f.FolderId == parentId))
                return Results.BadRequest(new ErrorDto("unknown_folder", $"No note folder '{parentId}'."));
            if (NoteTree.IsSelfOrDescendant(all, id, parentId))
                return Results.BadRequest(new ErrorDto("invalid_parent", "A folder cannot be moved inside itself."));

            folder.Name = name;
            folder.ParentId = parentId;
            folder.Order = body.Order;

            var saved = await folders.SaveFolderAsync(folder).ConfigureAwait(false);
            return saved.IsSuccess
                ? Results.NoContent()
                : Results.StatusCode(StatusCodes.Status500InternalServerError);
        });

        // Deleting a folder lifts its contents to the root instead of cascading, so a
        // folder delete never destroys a note. The desktop app does this across several
        // calls from its view model; here it is one request, because a client that dies
        // half way through would otherwise leave notes filed under a folder that is gone.
        endpoints.MapDelete("/api/note-folders/{id}", async (
            string id,
            INoteFolderService folders,
            INoteService notes) =>
        {
            var all = (await folders.GetAllFoldersAsync().ConfigureAwait(false)).ToList();
            if (!all.Any(f => f.FolderId == id))
                return Results.NotFound(new ErrorDto("unknown_folder", $"No note folder '{id}'."));

            var orphanedNotes = (await notes.GetAllNotesAsync().ConfigureAwait(false))
                .Where(n => n.FolderId == id)
                .ToList();
            foreach (var note in orphanedNotes)
            {
                note.FolderId = null;
                note.FolderPath = string.Empty;
                await notes.SaveNoteAsync(note).ConfigureAwait(false);
            }

            foreach (var child in all.Where(f => f.ParentId == id))
            {
                child.ParentId = null;
                await folders.SaveFolderAsync(child).ConfigureAwait(false);
            }

            var deleted = await folders.DeleteFolderAsync(id).ConfigureAwait(false);
            return deleted.IsSuccess
                ? Results.NoContent()
                : Results.StatusCode(StatusCodes.Status500InternalServerError);
        });
    }

    /// <summary>Null and empty both mean the root, and a client may send either.</summary>
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
