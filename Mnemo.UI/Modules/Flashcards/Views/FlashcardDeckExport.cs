using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Platform.Storage;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays.Transfer;

namespace Mnemo.UI.Modules.Flashcards.Views;

/// <summary>
/// Deck-scoped export flow (⋯ → Export) shared by the deck view. Presents the export-only
/// <see cref="TransferDialog"/>, then runs the chosen format's adapter with the deck id as the
/// portable payload, the same contract the library uses (a deck id string resolves to the deck's
/// cards for every format, with CSV taking a single-element id array).
/// </summary>
internal static class FlashcardDeckExport
{
    public static async Task RunAsync(
        Visual owner,
        IOverlayService overlayService,
        IImportExportCoordinator coordinator,
        ILocalizationService localization,
        string deckId,
        string deckName)
    {
        var capabilities = coordinator.GetCapabilities("flashcards").Where(c => c.SupportsExport).ToArray();
        var exportFormats = new List<TransferExportFormatOption>();
        foreach (var capability in capabilities)
        {
            var (nameKey, captionKey) = capability.FormatId switch
            {
                "flashcards.mnemo" => ("TransferFormatArchive", "TransferFormatCaptionArchive"),
                "flashcards.csv" => ("TransferFormatCsv", "TransferFormatCaptionCsv"),
                "flashcards.anki" => ("TransferFormatAnki", "TransferFormatCaptionAnki"),
                _ => ((string?)null, (string?)null)
            };
            exportFormats.Add(new TransferExportFormatOption
            {
                FormatId = capability.FormatId,
                ExtensionLabel = capability.Extensions.FirstOrDefault() ?? ".mnemo",
                DisplayName = nameKey != null ? localization.T(nameKey, "Common") : capability.DisplayName,
                Caption = captionKey != null ? localization.T(captionKey, "Common") : null,
                Extensions = capability.Extensions
            });
        }

        var choice = await TransferDialog.ShowAsync(overlayService, new TransferDialogContext
        {
            ContentType = "flashcards",
            Direction = TransferDialogDirection.ExportOnly,
            ImportTitle = localization.T("TransferExportDeckTitle", "Flashcards"),
            ExportTitle = localization.T("TransferExportDeckTitle", "Flashcards"),
            ExportSubtitle = string.IsNullOrWhiteSpace(deckName)
                ? null
                : string.Format(localization.T("TransferFromFormat", "Flashcards"), deckName),
            ItemNounSingular = localization.T("TransferNounSingular", "Flashcards"),
            ItemNounPlural = localization.T("TransferNounPlural", "Flashcards"),
            ExportFormats = exportFormats,
            Coordinator = coordinator
        }).ConfigureAwait(true);
        if (choice?.Format == null)
            return;

        var topLevel = TopLevel.GetTopLevel(owner);
        if (topLevel?.StorageProvider == null)
            return;

        var extension = choice.Format.Extensions.FirstOrDefault() ?? ".mnemo";
        var suggestedName = string.IsNullOrWhiteSpace(deckName) ? "deck" : SanitizeFileName(deckName);
        var saveFile = await topLevel.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = localization.T("TransferExportDeckTitle", "Flashcards"),
            SuggestedFileName = $"{suggestedName}{extension}",
            DefaultExtension = extension.TrimStart('.'),
            FileTypeChoices = [new FilePickerFileType(choice.Format.DisplayName) { Patterns = choice.Format.Extensions.Select(ext => $"*{ext}").ToArray() }]
        });
        if (saveFile == null)
            return;

        // CSV resolves decks by id list; a bare string would silently export every deck.
        object payload = choice.Format.FormatId == "flashcards.csv"
            ? new[] { deckId }
            : deckId;
        var export = await coordinator.ExportAsync(new ImportExportRequest
        {
            ContentType = "flashcards",
            FormatId = choice.Format.FormatId,
            FilePath = saveFile.Path.LocalPath,
            Payload = payload
        }).ConfigureAwait(true);

        var exportSucceeded = export.IsSuccess && export.Value is { Success: true };
        await overlayService.CreateDialogAsync(
            exportSucceeded ? localization.T("ExportCompleteTitle", "Common") : localization.T("ExportFailedTitle", "Common"),
            exportSucceeded
                ? localization.T("TransferExportFinished", "Common")
                : export.Value?.ErrorMessage ?? export.ErrorMessage ?? localization.T("TransferExportFailed", "Common")).ConfigureAwait(true);
    }

    private static string SanitizeFileName(string value)
    {
        var name = string.IsNullOrWhiteSpace(value) ? "flashcards" : value.Trim();
        foreach (var invalid in System.IO.Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');
        return name;
    }
}
