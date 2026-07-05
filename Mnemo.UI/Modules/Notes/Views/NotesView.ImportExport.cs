using System;
using System.Collections.Generic;
using System.Linq;
using Avalonia;
using System.Text.Json;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays.Transfer;
using Mnemo.UI.Modules.Notes.ViewModels;

namespace Mnemo.UI.Modules.Notes.Views;

public partial class NotesView
{
    private const string ScopeThisNote = "note";
    private const string ScopeFolder = "folder";
    private const string ScopeAllNotes = "all";
    private const string PdfFormatId = "notes.pdf";

    private async void OnExportPdfClick(object? sender, RoutedEventArgs e)
    {
        var services = (Application.Current as App)?.Services;
        if (services == null || DataContext is not NotesViewModel vm)
            return;
        await OpenPdfExportOverlayAsync(services, vm).ConfigureAwait(true);
    }

    private async Task OpenPdfExportOverlayAsync(IServiceProvider services, NotesViewModel vm)
    {
        var overlayService = services.GetService<IOverlayService>();
        if (overlayService == null || vm.SelectedNote == null)
            return;
        await FlushEditorToSelectedNoteAsync().ConfigureAwait(true);
        var json = JsonSerializer.Serialize(vm.SelectedNote);
        var clone = JsonSerializer.Deserialize<Note>(json);
        if (clone == null)
            return;
        var overlay = new NotePdfExportOverlay();
        overlay.InitializeForNote(clone);
        var overlayId = overlayService.CreateOverlay(overlay, new OverlayOptions
        {
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true
        }, "NotePdfExport");
        overlay.CloseRequested = () => overlayService.CloseOverlay(overlayId);
    }

    private async void OnTransferClick(object? sender, RoutedEventArgs e)
    {
        var services = (Application.Current as App)?.Services;
        if (services == null || DataContext is not NotesViewModel vm)
            return;

        var coordinator = services.GetService<IImportExportCoordinator>();
        var overlayService = services.GetService<IOverlayService>();
        var localization = services.GetService<ILocalizationService>();
        if (coordinator == null || overlayService == null || localization == null)
            return;

        var selectedFolder = vm.SelectedTreeItem is { IsFolder: true } treeFolder ? treeFolder : null;
        var targetFolderId = selectedFolder?.FolderId ?? vm.SelectedNote?.FolderId;
        var canExportSelectedNote = vm.SelectedNote != null;

        var scopes = new List<TransferExportScopeOption>
        {
            new()
            {
                ScopeId = ScopeThisNote,
                Label = localization.T("TransferScopeThisNote", "Notes"),
                IsEnabled = canExportSelectedNote
            }
        };
        if (selectedFolder != null)
        {
            scopes.Add(new TransferExportScopeOption
            {
                ScopeId = ScopeFolder,
                Label = localization.T("TransferScopeFolder", "Notes"),
                Count = selectedFolder.NoteCount
            });
        }

        scopes.Add(new TransferExportScopeOption
        {
            ScopeId = ScopeAllNotes,
            Label = localization.T("TransferScopeAllNotes", "Notes"),
            Count = vm.Notes.Count
        });

        var exportSource = vm.SelectedNote?.Title ?? selectedFolder?.Name;
        var context = new TransferDialogContext
        {
            ContentType = "notes",
            Direction = TransferDialogDirection.Both,
            StartWithImport = !canExportSelectedNote,
            ImportTitle = localization.T("TransferImportTitle", "Notes"),
            ExportTitle = localization.T("TransferExportTitle", "Notes"),
            ImportSubtitle = selectedFolder != null
                ? string.Format(localization.T("TransferIntoFormat", "Notes"), selectedFolder.Name)
                : null,
            ExportSubtitle = exportSource != null
                ? string.Format(localization.T("TransferFromFormat", "Notes"), exportSource)
                : null,
            ItemNounSingular = localization.T("TransferNounSingular", "Notes"),
            ItemNounPlural = localization.T("TransferNounPlural", "Notes"),
            ConflictQuestion = localization.T("TransferConflictQuestion", "Notes"),
            ImportCapabilities = coordinator.GetCapabilities("notes").Where(c => c.SupportsImport).ToArray(),
            ExportFormats = BuildNotesExportFormats(coordinator, localization),
            ExportScopes = scopes,
            Coordinator = coordinator,
            TargetFolderId = targetFolderId
        };

        var choice = await TransferDialog.ShowAsync(overlayService, context).ConfigureAwait(true);
        if (choice == null)
            return;

        if (choice.IsImport)
        {
            var summary = await TransferImportRunner.RunAsync(coordinator, "notes", choice, targetFolderId).ConfigureAwait(true);
            await TransferImportRunner.ShowSummaryAsync(overlayService, localization, context, summary).ConfigureAwait(true);
            if (summary.AnySucceeded)
                await vm.LoadNotesCommand.ExecuteAsync(null);
            return;
        }

        await ExportNotesAsync(services, vm, localization, overlayService, coordinator, choice, selectedFolder).ConfigureAwait(true);
    }

    private static IReadOnlyList<TransferExportFormatOption> BuildNotesExportFormats(IImportExportCoordinator coordinator, ILocalizationService localization)
    {
        var capabilities = coordinator.GetCapabilities("notes").Where(c => c.SupportsExport).ToArray();
        var formats = new List<TransferExportFormatOption>();

        var markdown = capabilities.FirstOrDefault(c => c.FormatId == "notes.markdown");
        if (markdown != null)
        {
            formats.Add(new TransferExportFormatOption
            {
                FormatId = markdown.FormatId,
                ExtensionLabel = ".md",
                DisplayName = localization.T("TransferFormatMarkdown", "Common"),
                Caption = localization.T("TransferFormatCaptionMarkdown", "Common"),
                Extensions = markdown.Extensions,
                ScopeIds = [ScopeThisNote]
            });
        }

        // PDF export runs through its own dedicated overlay rather than a format adapter.
        formats.Add(new TransferExportFormatOption
        {
            FormatId = PdfFormatId,
            ExtensionLabel = ".pdf",
            DisplayName = localization.T("TransferFormatPdf", "Common"),
            Caption = localization.T("TransferFormatCaptionPdf", "Common"),
            Extensions = [".pdf"],
            ScopeIds = [ScopeThisNote]
        });

        var package = capabilities.FirstOrDefault(c => c.FormatId == "notes.mnemo");
        if (package != null)
        {
            formats.Add(new TransferExportFormatOption
            {
                FormatId = package.FormatId,
                ExtensionLabel = ".mnemo",
                DisplayName = localization.T("TransferFormatArchive", "Common"),
                Caption = localization.T("TransferFormatCaptionArchive", "Common"),
                Extensions = package.Extensions
            });
        }

        return formats;
    }

    private async Task ExportNotesAsync(
        IServiceProvider services,
        NotesViewModel vm,
        ILocalizationService localization,
        IOverlayService overlayService,
        IImportExportCoordinator coordinator,
        TransferDialogResult choice,
        NoteTreeItemViewModel? selectedFolder)
    {
        if (choice.Format == null)
            return;

        if (choice.Format.FormatId == PdfFormatId)
        {
            await OpenPdfExportOverlayAsync(services, vm).ConfigureAwait(true);
            return;
        }

        object? payload = choice.Scope?.ScopeId switch
        {
            ScopeFolder when selectedFolder != null => CollectNoteIds(selectedFolder),
            ScopeAllNotes => null,
            _ => vm.SelectedNote
        };
        if (payload is Note)
            await FlushEditorToSelectedNoteAsync().ConfigureAwait(true);

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel?.StorageProvider == null)
            return;

        var extension = choice.Format.Extensions.FirstOrDefault() ?? ".mnemo";
        var suggestedName = payload is Note note ? SanitizeFileName(note.Title) : "notes";
        var saveFile = await topLevel.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = localization.T("TransferExportTitle", "Notes"),
            SuggestedFileName = $"{suggestedName}{extension}",
            DefaultExtension = extension.TrimStart('.'),
            FileTypeChoices = [new FilePickerFileType(choice.Format.DisplayName) { Patterns = choice.Format.Extensions.Select(ext => $"*{ext}").ToArray() }]
        });
        if (saveFile == null)
            return;

        var exportResult = await coordinator.ExportAsync(new ImportExportRequest
        {
            ContentType = "notes",
            FormatId = choice.Format.FormatId,
            FilePath = saveFile.Path.LocalPath,
            Payload = payload
        }).ConfigureAwait(true);

        var succeeded = exportResult.IsSuccess && exportResult.Value is { Success: true };
        await overlayService.CreateDialogAsync(
            succeeded ? localization.T("ExportCompleteTitle", "Common") : localization.T("ExportFailedTitle", "Common"),
            succeeded
                ? localization.T("TransferExportFinished", "Common")
                : exportResult.Value?.ErrorMessage ?? exportResult.ErrorMessage ?? localization.T("TransferExportFailed", "Common")).ConfigureAwait(true);
    }

    private static string[] CollectNoteIds(NoteTreeItemViewModel folder)
    {
        var ids = new List<string>();
        void Visit(NoteTreeItemViewModel item)
        {
            if (!item.IsFolder && item.Note != null)
                ids.Add(item.Note.NoteId);
            foreach (var child in item.Children)
                Visit(child);
        }

        Visit(folder);
        return ids.Distinct(StringComparer.Ordinal).ToArray();
    }

    private static string SanitizeFileName(string value)
    {
        var name = string.IsNullOrWhiteSpace(value) ? "notes" : value.Trim();
        foreach (var invalid in System.IO.Path.GetInvalidFileNameChars())
            name = name.Replace(invalid, '_');
        return name;
    }
}
