using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// The mindmap module's reference source for the asset sweep: every image a stored map still names.
/// </summary>
/// <remarks>
/// <para>
/// A map names files from one place, the content of its elements, in the two shapes that carry an
/// image: a canvas image dropped onto the background and an image inside a tree node. Both are read by
/// <see cref="CollectFrom"/>, which is the one list of fields the sweep knows about. A content kind
/// added later that stores a file belongs in that list; a file this misses is unreferenced, and the
/// sweeper deletes it once it is past the grace window.
/// </para>
/// <para>
/// Each map is loaded one at a time rather than through the library read, which skips a row it cannot
/// parse so that one damaged map cannot empty the gallery. That leniency is right for a gallery and
/// fatal for a sweep: a map absent because it could not be read is a map whose images look
/// unreferenced. So this fails closed, a map that will not load throws, the sweep stands down, and
/// nothing is deleted on the strength of a corpus that was only partly read.
/// </para>
/// </remarks>
public sealed class MindmapAssetReferenceSource : IAssetReferenceSource
{
    private readonly IMindmapService _mindmaps;

    public MindmapAssetReferenceSource(IMindmapService mindmaps)
    {
        _mindmaps = mindmaps;
    }

    /// <summary>Mindmaps have no migration standing between the stored data and this read.</summary>
    public bool IsReady => true;

    public async Task<IReadOnlyCollection<string>> CollectReferencedIdsAsync(CancellationToken cancellationToken = default)
    {
        var listed = await _mindmaps.ListAsync(cancellationToken).ConfigureAwait(false);
        if (!listed.IsSuccess || listed.Value is null)
            throw new InvalidOperationException("The mindmap library could not be listed; refusing to sweep against an unknown corpus.");

        var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var summary in listed.Value)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var map = await _mindmaps.GetAsync(summary.Id, cancellationToken).ConfigureAwait(false);
            if (!map.IsSuccess)
                throw new InvalidOperationException($"Mindmap '{summary.Id}' could not be read; refusing to sweep against a partly read corpus.");
            // Listed but absent: a delete committed between the two reads. The next sweep sees a
            // consistent state; this one stands down.
            if (map.Value is null)
                throw new InvalidOperationException($"Mindmap '{summary.Id}' is listed but missing; refusing to sweep until the corpus reads consistently.");

            CollectFrom(map.Value, referenced);
        }

        return referenced;
    }

    /// <summary>Every field of a map that can name a stored file.</summary>
    private static void CollectFrom(MindmapDocument document, HashSet<string> into)
    {
        foreach (var element in document.Elements)
        {
            var assetId = element.Content switch
            {
                CanvasImageContent canvas => canvas.AssetId,
                ImageContent image => image.AssetId,
                _ => null,
            };

            if (ParseReference(assetId) is { } id)
                into.Add(id);
        }
    }

    /// <summary>The asset id a stored reference names, or null when it points somewhere this does not own.</summary>
    private static string? ParseReference(string? assetId)
    {
        if (string.IsNullOrWhiteSpace(assetId))
            return null;

        // A rooted path is a desktop-era reference into the shared images directory, which nothing
        // sweeps. One pointing into the mindmap directory should not exist, but if it does, reading it
        // as a reference errs toward keeping the file.
        if (Path.IsPathRooted(assetId))
            return MnemoAppPaths.IsPathUnderMindmapAssetsDirectory(assetId) ? Path.GetFileName(assetId) : null;

        // Anything else that is a single safe segment is a managed asset id. Urls and other schemes
        // fall out here as unreferenced by the store, which is what they are.
        return assetId.Contains('/') || assetId.Contains('\\') || assetId.Contains(':') ? null : assetId;
    }
}
