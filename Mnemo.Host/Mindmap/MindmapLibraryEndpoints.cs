using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Models.Trash;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Mindmap.Trash;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// The gallery's data: every map with the metadata stored beside it rather than inside it (which folder
/// it sits in, which decks it links to), plus the folder tree itself.
/// <para>
/// Folder membership deliberately lives on the library row and not in the document, so moving a map
/// between folders is not an edit to the map and does not bump its revision or land in undo.
/// </para>
/// </summary>
public static class MindmapLibraryEndpoints
{
    public static void MapMindmapLibrary(this IEndpointRouteBuilder endpoints)
    {
        // The whole documents, not headers: the gallery draws a real thumbnail of each map, and a
        // thumbnail needs the graph. Headers alone are served by GET /api/mindmaps for callers that
        // only need to name the maps.
        endpoints.MapGet("/api/mindmaps/library", async (IMindmapService maps, CancellationToken cancellationToken) =>
        {
            var library = await maps.GetLibraryAsync(cancellationToken).ConfigureAwait(false);
            return library.IsSuccess && library.Value is not null
                ? MindmapJson.Ok(library.Value)
                : Error(library.ErrorMessage, "The mindmap library could not be read.");
        });

        endpoints.MapGet("/api/mindmaps/folders", async (IMindmapService maps, CancellationToken cancellationToken) =>
        {
            var folders = await maps.GetFoldersAsync(cancellationToken).ConfigureAwait(false);
            return folders.IsSuccess && folders.Value is not null
                ? MindmapJson.Ok(folders.Value)
                : Error(folders.ErrorMessage, "The mindmap folders could not be read.");
        });

        // Create and rename share one route: the service's SaveFolderAsync is an upsert keyed by id, and
        // splitting it into POST-then-PUT here would only re-derive which one the caller meant.
        endpoints.MapPut("/api/mindmaps/folders/{id}", async (
            string id,
            HttpRequest request,
            IMindmapService maps,
            CancellationToken cancellationToken) =>
        {
            var (ok, body, error) = await MindmapJson.ReadAsync<MindmapFolderDto>(request.Body, cancellationToken).ConfigureAwait(false);
            if (!ok)
                return error!;

            var name = body!.Name?.Trim();
            if (string.IsNullOrEmpty(name))
                return Results.BadRequest(new ErrorDto("invalid_name", "A folder name is required."));

            var saved = await maps
                .SaveFolderAsync(new MindmapFolder(id, name, Blank(body.ParentId), body.Order), cancellationToken)
                .ConfigureAwait(false);

            return saved.IsSuccess
                ? Results.NoContent()
                : Error(saved.ErrorMessage, $"Folder '{id}' could not be saved.");
        });

        // Deleting a folder takes the maps and subfolders inside it, all under one entry, so Undo puts
        // the arrangement back rather than leaving its contents scattered at the root.
        endpoints.MapDelete("/api/mindmaps/folders/{id}", async (string id, ITrashService trash, CancellationToken cancellationToken) =>
        {
            var action = await trash
                .DeleteAsync([new TrashDeleteRequest(MindmapFolderTrashSource.TrashKind, id)], cancellationToken)
                .ConfigureAwait(false);

            return action.Entries.Count == 0
                ? Results.NotFound(new ErrorDto("unknown_folder", $"No mindmap folder with id '{id}'."))
                : Results.Ok(TrashActionDto.FromModel(action));
        }).RequireTrash();

        endpoints.MapPut("/api/mindmaps/{id}/folder", async (
            string id,
            HttpRequest request,
            IMindmapService maps,
            CancellationToken cancellationToken) =>
        {
            var (ok, body, error) = await MindmapJson.ReadAsync<MoveMindmapDto>(request.Body, cancellationToken).ConfigureAwait(false);
            if (!ok)
                return error!;

            var moved = await maps.MoveToFolderAsync(id, Blank(body!.FolderId), cancellationToken).ConfigureAwait(false);
            return moved.IsSuccess
                ? Results.NoContent()
                : Error(moved.ErrorMessage, $"Mindmap '{id}' could not be filed.");
        });
    }

    private static IResult Error(string? detail, string fallback) =>
        Results.Json(new ErrorDto("mindmap_error", detail ?? fallback), statusCode: StatusCodes.Status500InternalServerError);

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
