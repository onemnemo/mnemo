using Microsoft.AspNetCore.Http;
using Microsoft.Net.Http.Headers;

namespace Mnemo.Host.Assets;

public static class ImageFileResults
{
    /// <summary>Serves a file named by its content hash. The name pins the bytes.</summary>
    public static IResult Immutable(HttpResponse response, string path)
    {
        response.Headers.CacheControl = "private, max-age=31536000, immutable";
        return Results.File(Path.GetFullPath(path), ManagedAssetStore.ContentTypeForExtension(Path.GetExtension(path)));
    }

    /// <summary>Serves a file whose bytes can change. An unchanged file answers 304.</summary>
    public static IResult Revalidated(HttpResponse response, string path)
    {
        var file = new FileInfo(path);
        var modified = file.LastWriteTimeUtc;
        response.Headers.CacheControl = "private, no-cache";
        return Results.File(
            file.FullName,
            ManagedAssetStore.ContentTypeForExtension(file.Extension),
            lastModified: modified,
            entityTag: new EntityTagHeaderValue($"\"{file.Length:x}-{modified.Ticks:x}\""));
    }
}
