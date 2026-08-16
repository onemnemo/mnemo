using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Profile;

/// <summary>
/// The avatar a user picks from their own files, stored in a directory of its own at
/// <c>%LocalAppData%\Mnemo\avatar\</c>.
/// </summary>
/// <remarks>
/// No sweeper runs here, and that is the point. A sweep decides what is live by walking a
/// list of reference sources, and an avatar is referenced from a settings key rather than
/// from any document those sources read, so a sweep that had not been taught about it would
/// collect the file in use. <see cref="PruneAllExcept"/> bounds the directory to one file
/// instead, which is all a single-avatar setting can ever need.
/// </remarks>
public static class ProfileAssetStore
{
    private static string ResolveDirectory() =>
        Path.Combine(MnemoAppPaths.GetLocalUserDataRoot(), "avatar");

    private static readonly ManagedAssetStore Store = new(ResolveDirectory, ManagedAssetStore.ImageExtensions);

    public static bool IsAllowedExtension(string? extension) => Store.IsAllowedExtension(extension);

    public static string GenerateAssetId(string? extension) => Store.GenerateAssetId(extension);

    /// <summary>Absolute path for a valid asset id, or null when the id is malformed.</summary>
    public static string? ResolvePath(string? assetId) => Store.ResolvePath(assetId);

    public static Task<string> SaveAsync(Stream content, string assetId, CancellationToken cancellationToken) =>
        Store.SaveAsync(content, assetId, cancellationToken);

    /// <summary>
    /// Removes every file in the directory except the one named. Called after a successful
    /// save and never before it, so an upload that fails leaves the picture already in use
    /// exactly where it was.
    /// </summary>
    public static void PruneAllExcept(string assetId)
    {
        var directory = ResolveDirectory();
        if (!Directory.Exists(directory))
            return;

        foreach (var path in Directory.EnumerateFiles(directory))
        {
            if (string.Equals(Path.GetFileName(path), assetId, StringComparison.OrdinalIgnoreCase))
                continue;

            try
            {
                File.Delete(path);
            }
            catch (IOException)
            {
                // A locked file stays until the next upload tries again. One stale avatar on
                // disk is not worth failing an upload that already succeeded.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }
}
