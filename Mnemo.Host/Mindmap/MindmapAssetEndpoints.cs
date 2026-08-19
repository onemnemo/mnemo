using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Host.Assets;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// Upload and serve for the images a map can carry on its canvas.
/// <para>
/// An element stores nothing but a file name, and the file lives in a directory the mindmap module
/// owns. Images uploaded before that directory existed are in the shared one and are still served
/// from there, so nothing needed migrating.
/// </para>
/// <para>
/// Deleting an image element never deletes its file: undo can bring the element back, and the file is
/// cheap next to losing the picture. Files no map names at all are the sweeper's business.
/// </para>
/// </summary>
public static class MindmapAssetEndpoints
{
    public static void MapMindmapAssets(this IEndpointRouteBuilder endpoints)
    {
        // The multipart body is read directly rather than bound as IFormFile so no antiforgery
        // filter is attached - loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/mindmaps/assets", async (HttpRequest request, MindmapAssets assets, CancellationToken cancellationToken) =>
        {
            // Extensions are the ones a browser can render, which is a subset of what the desktop
            // picker offered: a TIFF on the canvas would upload and then draw as a broken image.
            var store = assets.Store;
            if (!request.HasFormContentType)
                return Results.BadRequest(new ErrorDto("invalid_upload", "Expected a multipart form upload."));

            var form = await request.ReadFormAsync(cancellationToken).ConfigureAwait(false);
            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new ErrorDto("empty_upload", "No file was uploaded."));
            if (file.Length > ManagedAssetStore.MaxFileBytes)
                return Results.BadRequest(new ErrorDto("file_too_large", "The image exceeds the 20 MB limit."));

            var extension = ManagedAssetStore.SanitizeExtension(file.FileName);
            if (!store.IsAllowedExtension(extension))
                return Results.BadRequest(new ErrorDto("unsupported_image", "Only PNG, JPEG, GIF, WebP and BMP images can be placed on a map."));

            var assetId = store.GenerateAssetId(extension);
            try
            {
                await using var content = file.OpenReadStream();
                await store.SaveAsync(content, assetId, cancellationToken).ConfigureAwait(false);
            }
            catch (InvalidDataException)
            {
                return Results.BadRequest(new ErrorDto("unsupported_image", "The file does not contain the image data its name claims."));
            }

            return Results.Ok(new MindmapAssetDto(assetId, file.Length));
        });

        endpoints.MapGet("/api/mindmaps/assets/{assetId}", (string assetId, MindmapAssets assets) =>
        {
            var path = assets.Locate(assetId);
            if (path is null)
                return Results.NotFound();

            return Results.File(path, ManagedAssetStore.ContentTypeForExtension(Path.GetExtension(assetId)));
        });
    }
}
