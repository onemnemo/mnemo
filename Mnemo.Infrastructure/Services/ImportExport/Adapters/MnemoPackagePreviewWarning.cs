using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.ImportExport.Adapters;

/// <summary>
/// Builds the warning the three <c>.mnemo</c> format adapters (notes, flashcards, mindmaps) each
/// report when <see cref="Core.Services.IMnemoPackageService.PreviewAsync"/> itself fails, so the
/// wording and key stay identical across all three rather than drifting.
/// </summary>
internal static class MnemoPackagePreviewWarning
{
    /// <summary>
    /// The inner failure travels as the <c>error</c> parameter when there is one; otherwise a
    /// generic key covers a failure with nothing more specific to say.
    /// </summary>
    public static TransferWarning PreviewFailed(string? errorMessage) =>
        errorMessage is { } message
            ? TransferWarning.Of("PackagePreviewFailed", ("error", message))
            : TransferWarning.Of("PackagePreviewUnavailable");
}
