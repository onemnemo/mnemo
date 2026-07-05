using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Services;

namespace Mnemo.UI.Modules.Notes.Views;

/// <summary>A labeled dropdown row with an optional right-aligned value hint (e.g. "Medium" / "11 pt").</summary>
public sealed record PdfExportChoice(string Label, string? Hint = null);

/// <summary>
/// PDF export dialog: General (paper, margins, page numbers) and Rendering (body size,
/// title, render toggles) sections on the left, a single-page preview with pager and a
/// pages/size readout on the right. Ctrl/Cmd+Enter saves.
/// </summary>
public partial class NotePdfExportOverlay : UserControl
{
    private Note _note = null!;
    private INotePdfExportService _pdfExport = null!;
    private ILocalizationService _loc = null!;
    private IOverlayService? _overlayService;
    private CancellationTokenSource? _previewCts;
    private DispatcherTimer? _debounce;
    private bool _chromeApplied;

    private IReadOnlyList<byte[]> _previewPages = [];
    private int _currentPageIndex;
    private Bitmap? _currentPageBitmap;
    private long? _estimatedPdfBytes;

    public Action? CloseRequested { get; set; }

    public NotePdfExportOverlay()
    {
        InitializeComponent();
    }

    public void InitializeForNote(Note noteSnapshot)
    {
        if (noteSnapshot == null) throw new ArgumentNullException(nameof(noteSnapshot));
        _note = noteSnapshot;
        var app = Application.Current as App ?? throw new InvalidOperationException("Application not available.");
        var sp = app.Services ?? throw new InvalidOperationException("Application services not available.");
        _pdfExport = sp.GetRequiredService<INotePdfExportService>();
        _loc = sp.GetRequiredService<ILocalizationService>();
        _overlayService = sp.GetService<IOverlayService>();
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (_pdfExport == null) return;
        if (!_chromeApplied)
        {
            _chromeApplied = true;
            ApplyLocalizedChrome();
            PopulateChoices();
            IncludeTitleCheck.IsCheckedChanged += (_, _) => SchedulePreviewRebuild();
            _debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(280) };
            _debounce.Tick += (_, _) =>
            {
                _debounce!.Stop();
                _ = RebuildPreviewAsync();
            };
        }

        Dispatcher.UIThread.Post(() => Focus(), DispatcherPriority.Loaded);
        _ = RebuildPreviewAsync();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        _debounce?.Stop();
        _previewCts?.Cancel();
        _previewCts?.Dispose();
        _previewCts = null;
        _currentPageBitmap?.Dispose();
        _currentPageBitmap = null;
        base.OnDetachedFromVisualTree(e);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.Key == Key.Enter && e.KeyModifiers.HasFlag(OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control))
        {
            e.Handled = true;
            OnExportClick(this, new RoutedEventArgs());
            return;
        }
        base.OnKeyDown(e);
    }

    private void ApplyLocalizedChrome()
    {
        string T(string key) => _loc.T(key, "Notes");

        TitleText.Text = T("PdfExportTitle");
        DescriptionText.Text = T("PdfExportDescription");
        GeneralTabButton.Content = T("PdfTabGeneral");
        RenderingTabButton.Content = T("PdfTabRendering");
        PaperLabel.Text = T("PdfPaperSize");
        MarginLabel.Text = T("PdfMargins");
        FontSizeLabel.Text = T("PdfBaseFontSize");
        IncludeTitleCheck.Content = T("PdfIncludeNoteTitle");
        PageNumberPositionLabel.Text = T("PdfPageNumberPosition");
        PageNumberFormatLabel.Text = T("PdfPageNumberFormat");
        HighlightsToggleLabel.Text = T("PdfRenderHighlights");
        ImagesToggleLabel.Text = T("PdfRenderImages");
        FlashcardsToggleLabel.Text = T("PdfRenderFlashcards");
        PreviewCaption.Text = T("PdfPreviewCaption").ToUpperInvariant();
        FooterHintText.Text = T("PdfSavesToDownloads");
        CancelButton.Content = _loc.T("Cancel", "Common");
        ExportButtonLabel.Text = T("PdfExport");
        ExportShortcutHint.Text = OperatingSystem.IsMacOS() ? "⌘⏎" : "Ctrl+⏎";
        ToolTip.SetTip(PrevPageButton, T("PdfPreviousPage"));
        ToolTip.SetTip(NextPageButton, T("PdfNextPage"));
        PreviewStatusText.Text = string.Empty;
    }

    private void PopulateChoices()
    {
        string T(string key) => _loc.T(key, "Notes");

        PaperCombo.ItemsSource = new[] { T("PdfPaperA4"), T("PdfPaperLetter") };
        PaperCombo.SelectedIndex = 0;
        MarginCombo.ItemsSource = new[] { T("PdfMarginNormal"), T("PdfMarginNarrow") };
        MarginCombo.SelectedIndex = 0;
        PageNumberPositionCombo.ItemsSource = new[]
        {
            T("PdfPageNumberNone"),
            T("PdfPageNumberLeft"),
            T("PdfPageNumberCenter"),
            T("PdfPageNumberRight")
        };
        PageNumberPositionCombo.SelectedIndex = 2;
        PageNumberFormatCombo.ItemsSource = new[]
        {
            T("PdfPageNumberFormatCurrentTotal"),
            T("PdfPageNumberFormatCurrent")
        };
        PageNumberFormatCombo.SelectedIndex = 0;
        FontSizeCombo.ItemsSource = new[]
        {
            new PdfExportChoice(T("PdfFontSmall"), "10 pt"),
            new PdfExportChoice(T("PdfFontMedium"), "11 pt"),
            new PdfExportChoice(T("PdfFontLarge"), "12 pt"),
            new PdfExportChoice(T("PdfFontExtraLarge"), "14 pt")
        };
        FontSizeCombo.SelectedIndex = 1;
    }

    private void OnGeneralTabClick(object? sender, RoutedEventArgs e) => SetActiveTab(general: true);

    private void OnRenderingTabClick(object? sender, RoutedEventArgs e) => SetActiveTab(general: false);

    private void SetActiveTab(bool general)
    {
        GeneralPanel.IsVisible = general;
        RenderingPanel.IsVisible = !general;
        GeneralTabButton.Classes.Set("selected", general);
        RenderingTabButton.Classes.Set("selected", !general);
    }

    private NotePdfExportOptions BuildOptions()
    {
        var paper = PaperCombo.SelectedIndex <= 0 ? NotePdfPaperKind.A4 : NotePdfPaperKind.Letter;
        var margin = MarginCombo.SelectedIndex <= 0 ? NotePdfMarginPreset.Normal : NotePdfMarginPreset.Narrow;
        var fontPt = FontSizeCombo.SelectedIndex switch
        {
            0 => 10f,
            2 => 12f,
            3 => 14f,
            _ => 11f
        };
        return new NotePdfExportOptions
        {
            Paper = paper,
            Margin = margin,
            IncludeNoteTitle = IncludeTitleCheck.IsChecked != false,
            BaseFontSizePt = fontPt,
            PageNumberAlignment = PageNumberPositionCombo.SelectedIndex switch
            {
                0 => NotePdfPageNumberAlignment.None,
                1 => NotePdfPageNumberAlignment.Left,
                3 => NotePdfPageNumberAlignment.Right,
                _ => NotePdfPageNumberAlignment.Center
            },
            PageNumberFormat = PageNumberFormatCombo.SelectedIndex == 1
                ? NotePdfPageNumberFormat.CurrentPage
                : NotePdfPageNumberFormat.CurrentAndTotalPages,
            RenderColors = HighlightsToggle.IsChecked != false,
            RenderImages = ImagesToggle.IsChecked != false,
            PreviewRasterDpi = 120,
            BackgroundSwatchHexByName = PdfExportDawnSwatchResolver.GetBackgroundSwatchHexByName(),
            ForegroundSwatchHexByName = PdfExportDawnSwatchResolver.GetForegroundSwatchHexByName()
        };
    }

    private void OnSettingChanged(object? sender, SelectionChangedEventArgs e) => SchedulePreviewRebuild();

    private void OnToggleChanged(object? sender, RoutedEventArgs e) => SchedulePreviewRebuild();

    private void SchedulePreviewRebuild()
    {
        if (_debounce == null) return;
        _debounce.Stop();
        _debounce.Start();
    }

    private async Task RebuildPreviewAsync()
    {
        if (_pdfExport == null) return;
        _previewCts?.Cancel();
        _previewCts?.Dispose();
        _previewCts = new CancellationTokenSource();
        var ct = _previewCts.Token;
        if (_previewPages.Count == 0)
            PreviewStatusText.Text = _loc.T("PdfPreviewLoading", "Notes");
        try
        {
            var options = BuildOptions();
            var pages = await _pdfExport.GeneratePreviewPngPagesAsync(_note, options, ct).ConfigureAwait(true);
            if (ct.IsCancellationRequested) return;

            _previewPages = pages;
            _currentPageIndex = Math.Clamp(_currentPageIndex, 0, Math.Max(0, pages.Count - 1));
            ShowCurrentPage();
            PreviewStatusText.Text = pages.Count == 0 ? _loc.T("PdfPreviewError", "Notes") : string.Empty;

            _estimatedPdfBytes = null;
            UpdateDocumentStats();
            await EstimatePdfSizeAsync(options, ct).ConfigureAwait(true);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            PreviewSheet.IsVisible = false;
            PreviewStatusText.Text = _loc.T("PdfPreviewError", "Notes") + ": " + ex.Message;
        }
    }

    /// <summary>Generates the actual PDF once per settings change so the size readout is real, not guessed.</summary>
    private async Task EstimatePdfSizeAsync(NotePdfExportOptions options, CancellationToken ct)
    {
        try
        {
            var bytes = await _pdfExport.GeneratePdfAsync(_note, options, ct).ConfigureAwait(true);
            if (ct.IsCancellationRequested) return;
            _estimatedPdfBytes = bytes.LongLength;
            UpdateDocumentStats();
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception)
        {
            // Preview already rendered; a failed size estimate only leaves the readout at pages-only.
        }
    }

    private void ShowCurrentPage()
    {
        var oldBitmap = _currentPageBitmap;
        _currentPageBitmap = null;

        if (_previewPages.Count == 0)
        {
            PreviewImage.Source = null;
            PreviewSheet.IsVisible = false;
        }
        else
        {
            using var ms = new MemoryStream(_previewPages[_currentPageIndex]);
            _currentPageBitmap = new Bitmap(ms);
            PreviewImage.Source = _currentPageBitmap;
            PreviewSheet.IsVisible = true;
        }

        oldBitmap?.Dispose();
        UpdatePagerState();
    }

    private void UpdatePagerState()
    {
        var total = _previewPages.Count;
        PageCounterText.Text = total == 0
            ? "– / –"
            : string.Create(CultureInfo.CurrentCulture, $"{_currentPageIndex + 1} / {total}");
        PrevPageButton.IsEnabled = _currentPageIndex > 0;
        NextPageButton.IsEnabled = _currentPageIndex < total - 1;
    }

    private void UpdateDocumentStats()
    {
        var total = _previewPages.Count;
        if (total == 0)
        {
            DocumentStatsText.Text = string.Empty;
            return;
        }

        var pagesText = string.Format(
            CultureInfo.CurrentCulture,
            _loc.T(total == 1 ? "PdfPageCountOne" : "PdfPageCountMany", "Notes"),
            total);
        DocumentStatsText.Text = _estimatedPdfBytes is { } bytes
            ? pagesText + " · ~" + FormatFileSize(bytes)
            : pagesText;
    }

    private static string FormatFileSize(long bytes)
    {
        const double OneMb = 1024d * 1024d;
        if (bytes >= OneMb)
            return (bytes / OneMb).ToString("0.#", CultureInfo.CurrentCulture) + " MB";
        return Math.Max(1, (long)Math.Round(bytes / 1024d)).ToString(CultureInfo.CurrentCulture) + " KB";
    }

    private void OnPrevPageClick(object? sender, RoutedEventArgs e)
    {
        if (_currentPageIndex <= 0) return;
        _currentPageIndex--;
        ShowCurrentPage();
    }

    private void OnNextPageClick(object? sender, RoutedEventArgs e)
    {
        if (_currentPageIndex >= _previewPages.Count - 1) return;
        _currentPageIndex++;
        ShowCurrentPage();
    }

    private void OnCloseClick(object? sender, RoutedEventArgs e) => CloseRequested?.Invoke();

    private async void OnExportClick(object? sender, RoutedEventArgs e)
    {
        if (_pdfExport == null || ExportButton.IsLoading) return;
        var top = TopLevel.GetTopLevel(this);
        if (top?.StorageProvider == null) return;
        var title = string.IsNullOrWhiteSpace(_note.Title) ? "note" : _note.Title.Trim();
        foreach (var c in Path.GetInvalidFileNameChars())
            title = title.Replace(c, '_');
        var downloads = await top.StorageProvider.TryGetWellKnownFolderAsync(WellKnownFolder.Downloads).ConfigureAwait(true);
        var file = await top.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = _loc.T("PdfExportPickerTitle", "Notes"),
            SuggestedFileName = title + ".pdf",
            SuggestedStartLocation = downloads,
            DefaultExtension = "pdf",
            FileTypeChoices =
            [
                new FilePickerFileType("PDF") { Patterns = ["*.pdf"] }
            ]
        }).ConfigureAwait(true);
        if (file == null) return;
        ExportButton.IsLoading = true;
        try
        {
            var bytes = await _pdfExport.GeneratePdfAsync(_note, BuildOptions()).ConfigureAwait(true);
            await using var stream = await file.OpenWriteAsync().ConfigureAwait(true);
            await stream.WriteAsync(bytes).ConfigureAwait(true);
            if (_overlayService != null)
                await _overlayService.CreateDialogAsync(
                    _loc.T("PdfExportCompleteTitle", "Notes"),
                    _loc.T("PdfExportCompleteMessage", "Notes")).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            if (_overlayService != null)
                await _overlayService.CreateDialogAsync(
                    _loc.T("PdfExportFailedTitle", "Notes"),
                    ex.Message).ConfigureAwait(true);
        }
        finally
        {
            ExportButton.IsLoading = false;
        }
    }
}
