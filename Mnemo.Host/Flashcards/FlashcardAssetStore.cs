using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Owns the naming rules for card attachment images. The desktop stores each attachment as a
/// copy under the app images directory named <c>{attachmentId}{ext}</c>, so the servable asset
/// id is exactly that filename and the attachment id is the filename without its extension.
/// Keeping the two derivable from each other means the host never has to put an absolute path
/// on the wire, and the serve route can never reach outside the images directory.
/// </summary>
/// <remarks>
/// The mechanics live in <see cref="ManagedAssetStore"/>, shared with notes and chat; this
/// class pins the flashcard specifics: the shared images directory and the desktop picker's
/// extension list.
/// </remarks>
public static class FlashcardAssetStore
{
    /// <summary>Upper bound on an uploaded image (20 MB), matching every other asset store.</summary>
    public const long MaxFileBytes = ManagedAssetStore.MaxFileBytes;

    /// <summary>The extensions the desktop's own image picker offers. Anything else is rejected.</summary>
    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp",
    };

    private static readonly ManagedAssetStore Store = new(MnemoAppPaths.GetImagesDirectory, ImageExtensions);

    public static string Directory => Store.Directory;

    public static bool IsImageExtension(string? extension) => Store.IsAllowedExtension(extension);

    public static string ContentTypeForExtension(string extension) =>
        ManagedAssetStore.ContentTypeForExtension(extension);

    /// <summary>
    /// A well-formed asset id is a single <c>name.ext</c> path segment with an image extension
    /// and no directory separators or traversal - the only shape <see cref="Generate"/> mints,
    /// and the guard that keeps the serve route inside the images directory.
    /// </summary>
    public static bool IsValidAssetId(string? assetId) => Store.IsValidAssetId(assetId);

    /// <summary>Mints an asset id for an uploaded image, carrying its (validated) extension.</summary>
    public static string Generate(string extension) => Store.GenerateAssetId(extension);

    /// <summary>The attachment id an asset id belongs to - the filename without its extension.</summary>
    public static string AttachmentIdForAssetId(string assetId) =>
        Path.GetFileNameWithoutExtension(assetId);

    /// <summary>Absolute path for a valid asset id, or null when the id is malformed.</summary>
    public static string? ResolvePath(string? assetId) => Store.ResolvePath(assetId);

    /// <summary>
    /// The servable asset id for a stored attachment path, or null when the file is not a
    /// managed copy under the images directory. Imported decks can carry attachments that point
    /// elsewhere on disk; the host will not serve those, and the client renders a placeholder.
    /// </summary>
    public static string? AssetIdForPath(string? path) => Store.AssetIdForPath(path);
}
