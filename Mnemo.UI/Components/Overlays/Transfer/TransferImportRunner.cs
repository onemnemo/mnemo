using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.UI.Components.Overlays.Transfer;

/// <summary>
/// Aggregate outcome of importing a batch of files chosen in the transfer dialog.
/// </summary>
public sealed class TransferImportRunSummary
{
    public int SucceededFiles { get; set; }

    public int FailedFiles { get; set; }

    /// <summary>Total imported items across all files and payload kinds.</summary>
    public int ImportedItems { get; set; }

    public List<string> Errors { get; } = new();

    public bool AnySucceeded => SucceededFiles > 0;
}

/// <summary>
/// Shared count-with-noun phrasing used by transfer call sites, matching the dialog's footer.
/// </summary>
public static class TransferText
{
    public static string ItemsLabel(ILocalizationService? localization, int count, string nounSingular, string nounPlural) => count == 1
        ? string.Format(localization?.T("TransferOneItemFormat", "Common") ?? "1 {0}", nounSingular)
        : string.Format(localization?.T("TransferManyItemsFormat", "Common") ?? "{0} {1}", count, nounPlural);
}

/// <summary>
/// Runs the import half of a <see cref="TransferDialogResult"/>: one coordinator request
/// per queued file, forwarding the chosen conflict policy and target folder.
/// </summary>
public static class TransferImportRunner
{
    public static async Task<TransferImportRunSummary> RunAsync(
        IImportExportCoordinator coordinator,
        string contentType,
        TransferDialogResult choice,
        string? targetFolderId = null)
    {
        var summary = new TransferImportRunSummary();
        foreach (var file in choice.Files)
        {
            var result = await coordinator.ImportAsync(new ImportExportRequest
            {
                ContentType = contentType,
                FormatId = file.FormatId,
                FilePath = file.FilePath,
                Options = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
                {
                    [ImportExportOptionKeys.ConflictPolicy] = choice.ConflictPolicy,
                    [ImportExportOptionKeys.TargetFolderId] = targetFolderId
                }
            }).ConfigureAwait(true);

            if (result.IsSuccess && result.Value is { Success: true })
            {
                summary.SucceededFiles++;
                summary.ImportedItems += result.Value.ProcessedCounts
                    .Where(pair => !string.Equals(pair.Key, "skipped", StringComparison.OrdinalIgnoreCase))
                    .Sum(pair => pair.Value);
            }
            else
            {
                summary.FailedFiles++;
                var error = result.Value?.ErrorMessage ?? result.ErrorMessage;
                summary.Errors.Add(string.IsNullOrWhiteSpace(error) ? file.FileName : $"{file.FileName}: {error}");
            }
        }

        return summary;
    }

    /// <summary>
    /// Shows the standard import outcome dialog for a completed run.
    /// </summary>
    public static async Task ShowSummaryAsync(
        IOverlayService overlayService,
        ILocalizationService localization,
        TransferDialogContext context,
        TransferImportRunSummary summary)
    {
        string message;
        if (summary.FailedFiles == 0)
        {
            message = string.Format(
                localization.T("TransferImportFinishedFormat", "Common"),
                TransferText.ItemsLabel(localization, summary.ImportedItems, context.ItemNounSingular, context.ItemNounPlural));
        }
        else
        {
            var errors = string.Join(Environment.NewLine, summary.Errors);
            message = summary.AnySucceeded
                ? string.Format(
                    localization.T("TransferImportPartialFormat", "Common"),
                    TransferText.ItemsLabel(localization, summary.ImportedItems, context.ItemNounSingular, context.ItemNounPlural),
                    errors)
                : errors;
        }

        await overlayService.CreateDialogAsync(
            summary.AnySucceeded ? localization.T("ImportCompleteTitle", "Common") : localization.T("ImportFailedTitle", "Common"),
            message).ConfigureAwait(true);
    }
}
