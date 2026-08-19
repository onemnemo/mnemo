using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Notes.Trash;

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
        }).RequireNotesMigrated();

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
        }).RequireNotesMigrated();

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
        }).RequireNotesMigrated();

        // Deleting a folder takes the notes and subfolders inside it, all under one entry, so Undo
        // puts the arrangement back rather than leaving its contents scattered at the root. Nothing
        // is destroyed: the whole subtree stays recoverable for thirty days.
        endpoints.MapDelete("/api/note-folders/{id}", async (
            string id,
            ITrashService trash,
            CancellationToken cancellationToken) =>
        {
            var action = await trash
                .DeleteAsync([new TrashDeleteRequest(NoteFolderTrashSource.TrashKind, id)], cancellationToken)
                .ConfigureAwait(false);

            return action.Entries.Count == 0
                ? Results.NotFound(new ErrorDto("unknown_folder", $"No note folder '{id}'."))
                : Results.Ok(TrashActionDto.FromModel(action));
        }).RequireNotesMigrated().RequireTrash();
    }

    /// <summary>Null and empty both mean the root, and a client may send either.</summary>
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
