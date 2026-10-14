using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Flashcards;

/// <summary>The asset id is the file name, so the serve route stays inside the managed directories.</summary>
public static class FlashcardAssetStore
{
    /// <summary>Upper bound on an uploaded image (20 MB), matching every other asset store.</summary>
    public const long MaxFileBytes = ManagedAssetStore.MaxFileBytes;

    /// <summary>The extensions the desktop's own image picker offers. Anything else is rejected.</summary>
    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp",
    };

    private static readonly ManagedAssetStore Shared = new(MnemoAppPaths.GetImageAssetsDirectory, ImageExtensions);

    private static readonly ManagedAssetStore Legacy = new(MnemoAppPaths.GetImagesDirectory, ImageExtensions);

    public static bool IsImageExtension(string? extension) => Shared.IsAllowedExtension(extension);

    public static string ContentTypeForExtension(string extension) =>
        ManagedAssetStore.ContentTypeForExtension(extension);

    public static string? ResolvePath(string? assetId)
    {
        var shared = Shared.ResolvePath(assetId);
        return shared is not null && File.Exists(shared) ? shared : Legacy.ResolvePath(assetId);
    }

    public static string? AssetIdForPath(string? path) => Shared.AssetIdForPath(path) ?? Legacy.AssetIdForPath(path);
}
