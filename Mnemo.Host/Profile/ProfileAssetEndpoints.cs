using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Host.Assets;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Profile;

/// <summary>
/// Upload and serve for a user-supplied profile picture. The bundled avatars ship with the
/// client and need no endpoint; only a picture from the user's own files does.
/// </summary>
public static class ProfileAssetEndpoints
{
    public static void MapProfileAssets(this IEndpointRouteBuilder endpoints)
    {
        // The multipart body is read directly rather than bound as IFormFile so no antiforgery
        // filter is attached - loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/profile/avatar", async (HttpRequest request, CancellationToken cancellationToken) =>
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
            if (!ProfileAssetStore.IsAllowedExtension(extension))
                return Results.BadRequest(new ErrorDto("unsupported_image", "Only PNG, JPEG, GIF, WebP and BMP images can be used."));

            var assetId = ProfileAssetStore.GenerateAssetId(extension);
            try
            {
                await using var content = file.OpenReadStream();
                await ProfileAssetStore.SaveAsync(content, assetId, cancellationToken).ConfigureAwait(false);
            }
            catch (InvalidDataException)
            {
                return Results.BadRequest(new ErrorDto("unsupported_image", "The file does not contain the image data its name claims."));
            }

            ProfileAssetStore.PruneAllExcept(assetId);
            return Results.Ok(new ProfileAvatarDto(assetId));
        });

        endpoints.MapGet("/api/profile/avatar/{assetId}", (string assetId) =>
        {
            var path = ProfileAssetStore.ResolvePath(assetId);
            return path is not null && File.Exists(path)
                ? Results.File(path, ManagedAssetStore.ContentTypeForExtension(Path.GetExtension(path)))
                : Results.NotFound();
        });
    }
}
