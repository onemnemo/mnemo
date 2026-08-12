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
/// The files go into the shared images directory rather than a store of the mindmap module's own,
/// because that is where the desktop put them and an element stores nothing but the file name. A map
/// made in either app therefore resolves in the other, and a map carrying an image from before this
/// route existed is served by it without a migration.
/// </para>
/// <para>
/// Deleting an image element never deletes its file: undo can bring the element back, and the file is
/// cheap next to losing the picture. Genuinely orphaned assets are the integrity sweep's business.
/// </para>
/// </summary>
public static class MindmapAssetEndpoints
{
    /// <remarks>
    /// Extensions are the ones a browser can render, which is a subset of what the desktop picker
    /// offered: a TIFF on the canvas would upload and then draw as a broken image.
    /// </remarks>
    private static readonly ManagedAssetStore Store =
        new(MnemoAppPaths.GetImagesDirectory, ManagedAssetStore.ImageExtensions);

    public static void MapMindmapAssets(this IEndpointRouteBuilder endpoints)
    {
        // The multipart body is read directly rather than bound as IFormFile so no antiforgery
        // filter is attached - loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/mindmaps/assets", async (HttpRequest request, CancellationToken cancellationToken) =>
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
            if (!Store.IsAllowedExtension(extension))
                return Results.BadRequest(new ErrorDto("unsupported_image", "Only PNG, JPEG, GIF, WebP and BMP images can be placed on a map."));

            var assetId = Store.GenerateAssetId(extension);
            try
            {
                await using var content = file.OpenReadStream();
                await Store.SaveAsync(content, assetId, cancellationToken).ConfigureAwait(false);
            }
            catch (InvalidDataException)
            {
                return Results.BadRequest(new ErrorDto("unsupported_image", "The file does not contain the image data its name claims."));
            }

            return Results.Ok(new MindmapAssetDto(assetId, file.Length));
        });

        endpoints.MapGet("/api/mindmaps/assets/{assetId}", (string assetId) =>
        {
            var path = Store.ResolvePath(assetId);
            if (path is null || !File.Exists(path))
                return Results.NotFound();

            return Results.File(path, ManagedAssetStore.ContentTypeForExtension(Path.GetExtension(assetId)));
        });
    }
}
