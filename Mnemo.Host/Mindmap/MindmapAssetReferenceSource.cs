using Mnemo.Core.Models.Mindmap;
using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// The mindmap module's reference source for the asset sweep: every image a stored map still names.
/// </summary>
/// <remarks>
/// <para>
/// A map names files from one place, the content of its elements, in the two shapes that carry an
/// image: a canvas image dropped onto the background and an image inside a tree node. Both are read by
/// <see cref="MindmapAssetReferences.Collect"/>, which is the one list of fields the sweep knows
/// about. A content kind added later that stores a file belongs in that list; a file this misses is
/// unreferenced, and the sweeper deletes it once it is past the grace window.
/// </para>
/// <para>
/// The walk covers maps the trash is holding as well as maps the library shows. A deleted map can be
/// restored for thirty days and has to come back with its images intact, so as far as the sweep is
/// concerned a held map is a map.
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
    private readonly IMindmapTrashStore _store;

    public MindmapAssetReferenceSource(IMindmapTrashStore store)
    {
        _store = store;
    }

    /// <summary>Mindmaps have no migration standing between the stored data and this read.</summary>
    public bool IsReady => true;

    public async Task<IReadOnlyCollection<string>> CollectReferencedIdsAsync(CancellationToken cancellationToken = default)
    {
        var ids = await _store.ListAllOwnedIdsAsync(cancellationToken).ConfigureAwait(false);

        var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in ids)
        {
            cancellationToken.ThrowIfCancellationRequested();

            MindmapDocument? map;
            try
            {
                map = await _store.LoadAllOwnedAsync(id, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                throw new InvalidOperationException(
                    $"Mindmap '{id}' could not be read; refusing to sweep against a partly read corpus.", ex);
            }

            // Listed but absent: a purge committed between the two reads. The next sweep sees a
            // consistent state; this one stands down.
            if (map is null)
                throw new InvalidOperationException(
                    $"Mindmap '{id}' is listed but missing; refusing to sweep until the corpus reads consistently.");

            MindmapAssetReferences.Collect(map, referenced);
        }

        return referenced;
    }
}
