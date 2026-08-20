using Mnemo.Core.Models;
using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Chat;

/// <summary>
/// Owns the on-disk chat-attachment store: where uploaded files live, how their ids map
/// to paths, and how a path maps back to a servable id. An asset id is a bare filename
/// (<c>{guid}{ext}</c>) so it can never escape the attachments directory, and the absolute
/// path is stored on the message: a real file the desktop app can open too.
///
/// Attachments are storage-and-display only: like the desktop, the model is not fed the
/// bytes, so nothing here touches the AI path.
/// </summary>
/// <remarks>
/// The mechanics live in <see cref="ManagedAssetStore"/>, shared with notes and flashcards;
/// chat is the store with no extension policy, since an attachment can be any file.
/// </remarks>
public static class ChatAssetStore
{
    /// <summary>Upper bound on an uploaded file (20 MB). Rejected above this.</summary>
    public const long MaxFileBytes = ManagedAssetStore.MaxFileBytes;

    private static readonly ManagedAssetStore Store = new(MnemoAppPaths.GetChatAttachmentsDirectory);

    public static string Directory => Store.Directory;

    public static bool IsImageExtension(string extension) =>
        ManagedAssetStore.ImageExtensions.Contains(extension);

    public static ChatAttachmentKind KindForExtension(string extension) =>
        IsImageExtension(extension) ? ChatAttachmentKind.Image : ChatAttachmentKind.File;

    public static string ContentTypeForExtension(string extension) =>
        ManagedAssetStore.ContentTypeForExtension(extension);

    /// <summary>
    /// A well-formed asset id is a single path segment of <c>id.ext</c> shape with no
    /// directory separators or traversal: the only shape <see cref="Generate"/> mints,
    /// and the guard that keeps the serve route from reaching outside the store.
    /// </summary>
    public static bool IsValidAssetId(string assetId) => Store.IsValidAssetId(assetId);

    /// <summary>Mints an asset id for an uploaded file, carrying its (sanitized) extension.</summary>
    public static string Generate(string? originalFileName) =>
        Store.GenerateAssetId(ManagedAssetStore.SanitizeExtension(originalFileName));

    /// <summary>Absolute path for a valid asset id, or null when the id is malformed.</summary>
    public static string? ResolvePath(string assetId) => Store.ResolvePath(assetId);

    /// <summary>
    /// The servable asset id for a stored path, or null when the path is not a managed
    /// copy under the attachments directory (e.g. a desktop-picked file elsewhere on disk,
    /// which the host will not serve).
    /// </summary>
    public static string? AssetIdForPath(string? path) => Store.AssetIdForPath(path);
}
