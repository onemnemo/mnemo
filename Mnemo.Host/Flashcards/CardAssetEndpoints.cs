using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
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
    /// <summary>The file limit plus room for the multipart framing around it.</summary>
    internal const long MaxRequestBytes = FlashcardAssetStore.MaxFileBytes + (1L * 1024 * 1024);

    public static void MapFlashcardAssets(this IEndpointRouteBuilder endpoints)
    {
        // The multipart body is read directly rather than bound as IFormFile so no antiforgery
        // filter is attached - loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/flashcards/assets", async (HttpRequest request, CancellationToken cancellationToken) =>
        {
            // Just above the file limit, so an oversized file still arrives whole and is refused below
            // with the limit named, rather than Kestrel resetting the connection mid-stream.
            var sizeLimit = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (sizeLimit is { IsReadOnly: false })
                sizeLimit.MaxRequestBodySize = MaxRequestBytes;

            if (!request.HasFormContentType)
                return Results.BadRequest(new ErrorDto("invalid_upload", "Expected a multipart form upload."));

            IFormCollection form;
            try
            {
                form = await request.ReadFormAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                return Results.Json(
                    new ErrorDto("file_too_large", "The image exceeds the 20 MB limit."),
                    statusCode: StatusCodes.Status413PayloadTooLarge);
            }
            catch (Exception ex) when (ex is IOException or InvalidDataException)
            {
                // A cut-off or malformed body, or a read timeout; only the 413 above means too big.
                return Results.Json(
                    new ErrorDto("invalid_upload", "The upload did not arrive in full. Try again."),
                    statusCode: ex is BadHttpRequestException bad ? bad.StatusCode : StatusCodes.Status400BadRequest);
            }

            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new ErrorDto("empty_upload", "No file was uploaded."));
            if (file.Length > FlashcardAssetStore.MaxFileBytes)
            {
                return Results.Json(
                    new ErrorDto("file_too_large", "The image exceeds the 20 MB limit."),
                    statusCode: StatusCodes.Status413PayloadTooLarge);
            }

            var extension = Path.GetExtension(file.FileName);
            if (!FlashcardAssetStore.IsImageExtension(extension))
                return Results.BadRequest(new ErrorDto("unsupported_image", "Only PNG, JPEG, GIF and WebP images can be attached."));

            var assetId = FlashcardAssetStore.Generate(extension);
            try
            {
                await using var content = file.OpenReadStream();
                await FlashcardAssetStore.SaveAsync(content, assetId, cancellationToken).ConfigureAwait(false);
            }
            catch (InvalidDataException)
            {
                return Results.BadRequest(new ErrorDto("unsupported_image", "The file does not contain the image data its name claims."));
            }

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
