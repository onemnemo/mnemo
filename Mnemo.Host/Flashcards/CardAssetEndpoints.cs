using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Upload and serve for card attachment images. <c>POST /api/flashcards/assets</c> stores an
/// uploaded image under the app images directory and returns the ids the card editor needs;
/// <c>GET /api/flashcards/assets/{assetId}</c> streams the bytes back. Both sit under
/// <c>/api</c>, so the per-launch bearer token guards them - the client fetches the bytes with
/// the auth header and renders them from a blob URL, since a bare &lt;img src&gt; could not
/// carry the token.
/// </summary>
/// <remarks>
/// Uploading is deliberately separate from saving the card, the way the desktop copies a picked
/// image the moment it is attached: the editor can show a real thumbnail before anything is
/// persisted. An upload that is never saved leaves an orphan file, which is what the desktop
/// does with a cancelled dialog too.
/// </remarks>
public static class CardAssetEndpoints
{
    public static void MapFlashcardAssets(this IEndpointRouteBuilder endpoints)
    {
        // The multipart body is read directly rather than bound as IFormFile so no antiforgery
        // filter is attached - loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/flashcards/assets", async (HttpRequest request) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new ErrorDto("invalid_upload", "Expected a multipart form upload."));

            var form = await request.ReadFormAsync().ConfigureAwait(false);
            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new ErrorDto("empty_upload", "No file was uploaded."));
            if (file.Length > FlashcardAssetStore.MaxFileBytes)
                return Results.BadRequest(new ErrorDto("file_too_large", "The image exceeds the 20 MB limit."));

            var extension = Path.GetExtension(file.FileName);
            if (!FlashcardAssetStore.IsImageExtension(extension))
                return Results.BadRequest(new ErrorDto("unsupported_image", "Only PNG, JPEG, GIF and WebP images can be attached."));

            var assetId = FlashcardAssetStore.Generate(extension);
            var path = FlashcardAssetStore.ResolvePath(assetId)!; // freshly generated -> always valid
            Directory.CreateDirectory(FlashcardAssetStore.Directory);
            await using (var stream = File.Create(path))
                await file.CopyToAsync(stream).ConfigureAwait(false);

            // The display name is the name the user's file had, matching the desktop, so two
            // images picked from same-named files read alike in the editor.
            var displayName = Path.GetFileName(file.FileName);
            if (string.IsNullOrWhiteSpace(displayName))
                displayName = assetId;

            return Results.Ok(new CardAssetDto(
                assetId,
                FlashcardAssetStore.AttachmentIdForAssetId(assetId),
                displayName,
                file.Length));
        });

        endpoints.MapGet("/api/flashcards/assets/{assetId}", (string assetId) =>
        {
            var path = FlashcardAssetStore.ResolvePath(assetId);
            if (path is null || !File.Exists(path))
                return Results.NotFound();

            return Results.File(path, FlashcardAssetStore.ContentTypeForExtension(Path.GetExtension(assetId)));
        });
    }
}
