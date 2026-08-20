using System.IO;
using System.Linq;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Chat;

/// <summary>
/// Upload and serve for chat attachments. <c>POST /api/chat/assets</c> stores an uploaded file
/// as a managed copy under the attachments directory and returns its id; <c>GET
/// /api/chat/assets/{assetId}</c> streams the bytes back. The id is a bare filename, so the
/// serve route can never read outside that directory. Both routes sit under <c>/api</c>, so the
/// per-launch bearer token guards them; the client fetches asset bytes with the auth header and
/// renders them from a blob URL rather than a bare &lt;img src&gt; that could not carry the token.
/// </summary>
public static class ChatAssetEndpoints
{
    public static void MapChatAssets(this IEndpointRouteBuilder endpoints)
    {
        // Read the multipart body directly (rather than binding IFormFile) so no antiforgery
        // filter is attached; loopback binding plus the bearer token are the security boundary.
        endpoints.MapPost("/api/chat/assets", async (HttpRequest request) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new ErrorDto("invalid_upload", "Expected a multipart form upload."));

            var form = await request.ReadFormAsync().ConfigureAwait(false);
            var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
            if (file is null || file.Length == 0)
                return Results.BadRequest(new ErrorDto("empty_upload", "No file was uploaded."));
            if (file.Length > ChatAssetStore.MaxFileBytes)
                return Results.BadRequest(new ErrorDto("file_too_large", "The file exceeds the 20 MB limit."));

            var assetId = ChatAssetStore.Generate(file.FileName);
            var path = ChatAssetStore.ResolvePath(assetId)!; // freshly generated → always valid
            Directory.CreateDirectory(ChatAssetStore.Directory);
            await using (var stream = File.Create(path))
                await file.CopyToAsync(stream).ConfigureAwait(false);

            var kind = ChatAssetStore.KindForExtension(Path.GetExtension(assetId)) == ChatAttachmentKind.Image
                ? "image"
                : "file";
            var displayName = Path.GetFileName(file.FileName);
            return Results.Ok(new ChatAssetDto(assetId, kind, string.IsNullOrWhiteSpace(displayName) ? null : displayName));
        });

        endpoints.MapGet("/api/chat/assets/{assetId}", (string assetId) =>
        {
            var path = ChatAssetStore.ResolvePath(assetId);
            if (path is null || !File.Exists(path))
                return Results.NotFound();

            return Results.File(path, ChatAssetStore.ContentTypeForExtension(Path.GetExtension(assetId)));
        });
    }
}
