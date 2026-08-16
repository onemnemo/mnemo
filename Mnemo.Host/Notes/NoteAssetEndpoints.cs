using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Host.Assets;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Notes;

/// <summary>
/// Upload and serve for note image blocks, plus the session handshake the asset sweep runs
/// on. Uploading is separate from saving the note, the way the desktop copies a picked image
/// the moment it is chosen: the block renders before the first autosave, and an upload whose
/// insert is undone becomes an orphan the sweeper collects once no session could redo it.
/// </summary>
public static class NoteAssetEndpoints
{
    public static void MapNoteAssets(this IEndpointRouteBuilder endpoints)
    {
        // The multipart body is read directly rather than bound as IFormFile so no antiforgery
        // filter is attached - loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/notes/assets", async (HttpRequest request, NoteAssets assets, CancellationToken cancellationToken) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new ErrorDto("invalid_upload", "Expected a multipart form upload."));

            var form = await request.ReadFormAsync(cancellationToken).ConfigureAwait(false);
            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new ErrorDto("empty_upload", "No file was uploaded."));
            if (file.Length > ManagedAssetStore.MaxFileBytes)
                return Results.BadRequest(new ErrorDto("file_too_large", "The image exceeds the 20 MB limit."));

            var extension = ManagedAssetStore.SanitizeExtension(file.FileName);
            if (!assets.Store.IsAllowedExtension(extension))
                return Results.BadRequest(new ErrorDto("unsupported_image", "Only PNG, JPEG, GIF, WebP and BMP images can be inserted."));

            var assetId = assets.Store.GenerateAssetId(extension);
            try
            {
                await using var content = file.OpenReadStream();
                await assets.Store.SaveAsync(content, assetId, cancellationToken).ConfigureAwait(false);
            }
            catch (InvalidDataException)
            {
                return Results.BadRequest(new ErrorDto("unsupported_image", "The file does not contain the image data its name claims."));
            }

            var displayName = Path.GetFileName(file.FileName);
            if (string.IsNullOrWhiteSpace(displayName))
                displayName = assetId;

            return Results.Ok(new NoteAssetDto(assetId, displayName, file.Length));
        }).RequireNotesMigrated();

        // Desktop-era image blocks store an absolute path into the shared images directory.
        // Those files stay where they are and are served read-only; the containment check is
        // what keeps this from being an arbitrary-file endpoint.
        endpoints.MapGet("/api/notes/assets/legacy", (string? path) =>
        {
            if (string.IsNullOrWhiteSpace(path) || !MnemoAppPaths.IsPathUnderImagesDirectory(path))
                return Results.NotFound();

            var extension = Path.GetExtension(path);
            if (!ManagedAssetStore.ImageExtensions.Contains(extension) || !File.Exists(path))
                return Results.NotFound();

            return Results.File(Path.GetFullPath(path), ManagedAssetStore.ContentTypeForExtension(extension));
        }).RequireNotesMigrated();

        // Serves a managed upload by full id, or resolves a bare guid - the shape an old
        // `attachment:{guid}:{name}` reference carries - against the note store first and the
        // shared legacy images directory second.
        endpoints.MapGet("/api/notes/assets/{assetId}", (string assetId, NoteAssets assets) =>
        {
            var exact = assets.Store.ResolvePath(assetId);
            if (exact is not null)
                return File.Exists(exact)
                    ? Results.File(exact, ManagedAssetStore.ContentTypeForExtension(Path.GetExtension(exact)))
                    : Results.NotFound();

            var byGuid = assets.Store.FindByBareId(assetId)
                ?? ManagedAssetStore.FindByBareId(MnemoAppPaths.GetImagesDirectory(), assetId, assets.Store);
            return byGuid is not null
                ? Results.File(byGuid, ManagedAssetStore.ContentTypeForExtension(Path.GetExtension(byGuid)))
                : Results.NotFound();
        }).RequireNotesMigrated();

        endpoints.MapPost("/api/notes/asset-sessions", (NoteAssets assets) =>
            Results.Ok(new NoteAssetSessionDto(assets.Sessions.Open()))).RequireNotesMigrated();

        // Closing a session means its undo history is gone, which is the moment cleanup
        // becomes safe: anything the final save did not keep can no longer be redone.
        endpoints.MapDelete("/api/notes/asset-sessions/{sessionId}", (string sessionId, NoteAssets assets) =>
        {
            if (!assets.Sessions.Close(sessionId))
                return Results.NotFound();

            assets.Sweeper.SweepInBackground();
            return Results.NoContent();
        }).RequireNotesMigrated();
    }
}
