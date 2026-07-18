using Mnemo.Core.Models;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Chat;

/// <summary>
/// Owns the on-disk chat-attachment store: where uploaded files live, how their ids map
/// to paths, and how a path maps back to a servable id. An asset id is a bare filename
/// (<c>{guid}{ext}</c>) so it can never escape the attachments directory, and the absolute
/// path is stored on the message — a real file the desktop app can open too.
///
/// Attachments are storage-and-display only: like the desktop, the model is not fed the
/// bytes, so nothing here touches the AI path.
/// </summary>
public static class ChatAssetStore
{
    /// <summary>Upper bound on an uploaded file (20 MB). Rejected above this.</summary>
    public const long MaxFileBytes = 20L * 1024 * 1024;

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
    };

    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".webp"] = "image/webp",
        [".bmp"] = "image/bmp",
    };

    public static string Directory => MnemoAppPaths.GetChatAttachmentsDirectory();

    public static bool IsImageExtension(string extension) => ImageExtensions.Contains(extension);

    public static ChatAttachmentKind KindForExtension(string extension) =>
        IsImageExtension(extension) ? ChatAttachmentKind.Image : ChatAttachmentKind.File;

    public static string ContentTypeForExtension(string extension) =>
        ContentTypes.TryGetValue(extension, out var type) ? type : "application/octet-stream";

    /// <summary>
    /// A well-formed asset id is a single path segment of <c>id.ext</c> shape with no
    /// directory separators or traversal — the only shape <see cref="Generate"/> mints,
    /// and the guard that keeps the serve route from reaching outside the store.
    /// </summary>
    public static bool IsValidAssetId(string assetId)
    {
        if (string.IsNullOrWhiteSpace(assetId))
            return false;
        if (assetId.Contains('/') || assetId.Contains('\\') || assetId.Contains(".."))
            return false;
        return string.Equals(assetId, Path.GetFileName(assetId), StringComparison.Ordinal);
    }

    /// <summary>Mints an asset id for an uploaded file, carrying its (sanitized) extension.</summary>
    public static string Generate(string? originalFileName)
    {
        var ext = Path.GetExtension(originalFileName) ?? string.Empty;
        // Keep only a short, safe extension; drop anything unexpected.
        if (ext.Length > 8 || ext.Any(c => !char.IsLetterOrDigit(c) && c != '.'))
            ext = string.Empty;
        return Guid.NewGuid().ToString("N") + ext.ToLowerInvariant();
    }

    /// <summary>Absolute path for a valid asset id, or null when the id is malformed.</summary>
    public static string? ResolvePath(string assetId) =>
        IsValidAssetId(assetId) ? Path.Combine(Directory, assetId) : null;

    /// <summary>
    /// The servable asset id for a stored path, or null when the path is not a managed
    /// copy under the attachments directory (e.g. a desktop-picked file elsewhere on disk,
    /// which the host will not serve).
    /// </summary>
    public static string? AssetIdForPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !MnemoAppPaths.IsPathUnderChatAttachmentsDirectory(path))
            return null;
        var name = Path.GetFileName(path);
        return IsValidAssetId(name) ? name : null;
    }
}
