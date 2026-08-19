using System.Collections.Generic;
using System.IO;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// The one list of places a mindmap can name a stored file, and how a stored reference reads.
/// </summary>
/// <remarks>
/// Two readers ask this: the sweep, which needs every file the library still points at, and a purge,
/// which needs the files one destroyed map used to point at. They must agree, or a purge queues a
/// file the sweep thinks is referenced, or worse the other way round. A content kind added later
/// that carries a file belongs in <see cref="Collect"/> and nowhere else.
/// </remarks>
public static class MindmapAssetReferences
{
    /// <summary>The owner key mindmap purges write into their cleanup jobs.</summary>
    public const string AssetOwner = "mindmap-assets";

    /// <summary>Adds every asset id the document names to <paramref name="into"/>.</summary>
    public static void Collect(MindmapDocument document, ISet<string> into)
    {
        foreach (var element in document.Elements)
        {
            var assetId = element.Content switch
            {
                CanvasImageContent canvas => canvas.AssetId,
                ImageContent image => image.AssetId,
                _ => null,
            };

            if (Parse(assetId) is { } id)
                into.Add(id);
        }
    }

    /// <summary>The asset id a stored reference names, or null when it points somewhere this does not own.</summary>
    public static string? Parse(string? assetId)
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
