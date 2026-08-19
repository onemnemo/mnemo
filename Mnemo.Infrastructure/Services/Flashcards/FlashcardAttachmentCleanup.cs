using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <summary>
/// Deletes the managed copies behind a set of attachment file paths, once whatever referenced
/// them (a card, a piece of material, a deck) is gone. Shared by every place that removes a
/// reference rather than duplicated at each one, so the guard against deleting the wrong file
/// only needs to be right in one spot.
/// </summary>
internal static class FlashcardAttachmentCleanup
{
    /// <summary>
    /// Deletes each path that is a managed copy under the app images directory, skipping anything
    /// else - an imported card can point at a file the user still has elsewhere on disk, and that
    /// file is never ours to remove. A missing <paramref name="images"/> (a test built without
    /// one) turns this into a no-op rather than a failure: the delete this follows still commits.
    /// </summary>
    public static async Task DeleteAsync(
        IImageAssetService? images, IEnumerable<string> filePaths, CancellationToken cancellationToken)
    {
        if (images is null)
            return;

        foreach (var path in filePaths)
        {
            if (string.IsNullOrWhiteSpace(path) || !MnemoAppPaths.IsPathUnderImagesDirectory(path))
                continue;
            await images.DeleteStoredFileAsync(path, cancellationToken).ConfigureAwait(false);
        }
    }
}
