using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Owns the naming rules for card attachment images. The desktop stores each attachment as a
/// copy under the app images directory named <c>{attachmentId}{ext}</c>, so the servable asset
/// id is exactly that filename and the attachment id is the filename without its extension.
/// Keeping the two derivable from each other means the host never has to put an absolute path
/// on the wire, and the serve route can never reach outside the images directory.
/// </summary>
public static class FlashcardAssetStore
{
    /// <summary>Upper bound on an uploaded image (20 MB), matching the chat asset limit.</summary>
    public const long MaxFileBytes = 20L * 1024 * 1024;

    /// <summary>The extensions the desktop's own image picker offers. Anything else is rejected.</summary>
    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp",
    };

    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".webp"] = "image/webp",
    };

    public static string Directory => MnemoAppPaths.GetImagesDirectory();

    public static bool IsImageExtension(string? extension) =>
        !string.IsNullOrEmpty(extension) && ImageExtensions.Contains(extension);

    public static string ContentTypeForExtension(string extension) =>
        ContentTypes.TryGetValue(extension, out var type) ? type : "application/octet-stream";

    /// <summary>
    /// A well-formed asset id is a single <c>name.ext</c> path segment with an image extension
    /// and no directory separators or traversal - the only shape <see cref="Generate"/> mints,
    /// and the guard that keeps the serve route inside the images directory.
    /// </summary>
    public static bool IsValidAssetId(string? assetId)
    {
        if (string.IsNullOrWhiteSpace(assetId))
            return false;
        if (assetId.Contains('/') || assetId.Contains('\\') || assetId.Contains(".."))
            return false;
        if (!string.Equals(assetId, Path.GetFileName(assetId), StringComparison.Ordinal))
            return false;
        return IsImageExtension(Path.GetExtension(assetId));
    }

    /// <summary>Mints an asset id for an uploaded image, carrying its (validated) extension.</summary>
    public static string Generate(string extension) =>
        Guid.NewGuid().ToString("N") + extension.ToLowerInvariant();

    /// <summary>The attachment id an asset id belongs to - the filename without its extension.</summary>
    public static string AttachmentIdForAssetId(string assetId) =>
        Path.GetFileNameWithoutExtension(assetId);

    /// <summary>Absolute path for a valid asset id, or null when the id is malformed.</summary>
    public static string? ResolvePath(string? assetId) =>
        IsValidAssetId(assetId) ? Path.Combine(Directory, assetId!) : null;

    /// <summary>
    /// The servable asset id for a stored attachment path, or null when the file is not a
    /// managed copy under the images directory. Imported decks can carry attachments that point
    /// elsewhere on disk; the host will not serve those, and the client renders a placeholder.
    /// </summary>
    public static string? AssetIdForPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !MnemoAppPaths.IsPathUnderImagesDirectory(path))
            return null;
        var name = Path.GetFileName(path);
        return IsValidAssetId(name) ? name : null;
    }
}
