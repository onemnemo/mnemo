using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Avalonia.VisualTree;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Components.Overlays.Transfer;
using Mnemo.UI.Controls;
using Mnemo.UI.Modules.Flashcards.ViewModels;
using Mnemo.UI.Services;

namespace Mnemo.UI.Modules.Flashcards.Views;

public partial class FlashcardDeckDetailView : UserControl, INotifyPropertyChanged
{
    private const double RetentionChartMaxBarHeight = 56d;
    private const double RetentionChartMinVisibleNonZeroHeight = 3d;

    private FlashcardDeckDetailViewModel? _viewModel;
    private readonly Dictionary<string, RichEditorBinding> _frontEditorBindings = new(StringComparer.Ordinal);
    private readonly Dictionary<string, RichEditorBinding> _backEditorBindings = new(StringComparer.Ordinal);
    private bool _isBackToTopVisible;

    public new event PropertyChangedEventHandler? PropertyChanged;

    public IRelayCommand<Flashcard?>? ToggleCardRowCommandProxy => _viewModel?.ToggleCardRowCommand;

    public string? ExpandedCardIdProxy => _viewModel?.ExpandedCardId;

    public string LocalizedCardDueProxy => _viewModel?.LocalizedCardDue ?? string.Empty;

    public IRelayCommand? CloseExpandedCardCommandProxy => _viewModel?.CloseExpandedCardCommand;

    public IRelayCommand? AddCardCommandProxy => _viewModel?.AddCardCommand;

    public IRelayCommand? SaveAndAddCardCommandProxy => _viewModel?.SaveAndAddCardCommand;

    public IRelayCommand? RevertEditCommandProxy => _viewModel?.RevertEditCommand;

    public IRelayCommand? SetEditorClassicTypeCommandProxy => _viewModel?.SetEditorClassicTypeCommand;

    public IRelayCommand? SetEditorClozeTypeCommandProxy => _viewModel?.SetEditorClozeTypeCommand;

    public bool IsEditorClozeProxy => _viewModel?.IsEditorClozeType == true;
    public bool IsEditorBackEditableProxy => _viewModel?.IsEditorBackEditable == true;

    public FlashcardType EditorCardTypeProxy => _viewModel?.EditorCardType ?? FlashcardType.Classic;

    public string EditorFrontProxy => _viewModel?.EditorFront ?? string.Empty;

    public IReadOnlyList<InlineSpan> EditorFrontSpansProxy
    {
        get => _viewModel?.EditorFrontSpans ?? new List<InlineSpan> { InlineSpan.Plain(string.Empty) };
    }

    public IReadOnlyList<InlineSpan> EditorBackSpansProxy
    {
        get => _viewModel?.EditorBackSpans ?? new List<InlineSpan> { InlineSpan.Plain(string.Empty) };
    }

    public string EditorTagsProxy
    {
        get => _viewModel?.EditorTags ?? string.Empty;
        set
        {
            if (_viewModel is not null && !string.Equals(_viewModel.EditorTags, value, StringComparison.Ordinal))
                _viewModel.EditorTags = value;
        }
    }

    public IReadOnlyList<FlashcardRetentionTrendPoint> RetentionTrendPointsProxy =>
        _viewModel is null ? Array.Empty<FlashcardRetentionTrendPoint>() : _viewModel.RetentionTrendPoints;

    public IReadOnlyList<RetentionTrendBarPoint> RetentionTrendBarsProxy =>
        _viewModel is null
            ? Array.Empty<RetentionTrendBarPoint>()
            : BuildRetentionTrendBars(_viewModel.RetentionTrendPoints);

    public IAsyncRelayCommand? DeleteCardCommandProxy => _viewModel?.DeleteCardCommand;

    public IRelayCommand? CancelEditCommandProxy => _viewModel?.CancelEditCommand;
    public bool IsBackToTopVisibleProxy => _isBackToTopVisible;

    public FlashcardDeckDetailView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        DeckScrollViewer.ScrollChanged += OnDeckScrollChanged;
        Loaded += OnFlashcardDeckLoaded;
        Unloaded += OnFlashcardDeckUnloaded;
        AttachViewModel(DataContext as FlashcardDeckDetailViewModel);
    }

    private void OnFlashcardDeckLoaded(object? sender, RoutedEventArgs e)
    {
        if (Application.Current is App app && app.Services?.GetService<IFlashcardDeckKeybindContext>() is { } ctx)
            ctx.Attach(this);
    }

    private void OnFlashcardDeckUnloaded(object? sender, RoutedEventArgs e)
    {
        if (Application.Current is App app && app.Services?.GetService<IFlashcardDeckKeybindContext>() is { } ctx)
            ctx.Detach(this);
    }

    private void OnDataContextChanged(object? sender, EventArgs e) =>
        AttachViewModel(DataContext as FlashcardDeckDetailViewModel);

    private void AttachViewModel(FlashcardDeckDetailViewModel? next)
    {
        if (ReferenceEquals(_viewModel, next))
            return;

        if (_viewModel is not null)
        {
            _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
            _viewModel.RetentionTrendPoints.CollectionChanged -= OnRetentionTrendPointsChanged;
        }

        _viewModel = next;

        if (_viewModel is not null)
        {
            _viewModel.PropertyChanged += OnViewModelPropertyChanged;
            _viewModel.RetentionTrendPoints.CollectionChanged += OnRetentionTrendPointsChanged;
        }

        RaiseAllProxyPropertiesChanged();
    }

    private void OnRetentionTrendPointsChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        RaisePropertyChanged(nameof(RetentionTrendPointsProxy));
        RaisePropertyChanged(nameof(RetentionTrendBarsProxy));
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(FlashcardDeckDetailViewModel.EditorFrontSpans):
                RaisePropertyChanged(nameof(EditorFrontSpansProxy));
                return;
            case nameof(FlashcardDeckDetailViewModel.EditorBackSpans):
                RaisePropertyChanged(nameof(EditorBackSpansProxy));
                return;
            case nameof(FlashcardDeckDetailViewModel.EditorFront):
                RaisePropertyChanged(nameof(EditorFrontProxy));
                return;
            case nameof(FlashcardDeckDetailViewModel.EditorTags):
                RaisePropertyChanged(nameof(EditorTagsProxy));
                return;
            case nameof(FlashcardDeckDetailViewModel.EditorCardType):
            case nameof(FlashcardDeckDetailViewModel.IsEditorClozeType):
                RaisePropertyChanged(nameof(EditorCardTypeProxy));
                RaisePropertyChanged(nameof(IsEditorClozeProxy));
                RaisePropertyChanged(nameof(IsEditorBackEditableProxy));
                return;
            default:
                RaiseAllProxyPropertiesChanged();
                return;
        }
    }

    private void RaiseAllProxyPropertiesChanged()
    {
        RaisePropertyChanged(nameof(ToggleCardRowCommandProxy));
        RaisePropertyChanged(nameof(ExpandedCardIdProxy));
        RaisePropertyChanged(nameof(LocalizedCardDueProxy));
        RaisePropertyChanged(nameof(CloseExpandedCardCommandProxy));
        RaisePropertyChanged(nameof(AddCardCommandProxy));
        RaisePropertyChanged(nameof(SaveAndAddCardCommandProxy));
        RaisePropertyChanged(nameof(RevertEditCommandProxy));
        RaisePropertyChanged(nameof(SetEditorClassicTypeCommandProxy));
        RaisePropertyChanged(nameof(SetEditorClozeTypeCommandProxy));
        RaisePropertyChanged(nameof(IsEditorClozeProxy));
        RaisePropertyChanged(nameof(IsEditorBackEditableProxy));
        RaisePropertyChanged(nameof(EditorCardTypeProxy));
        RaisePropertyChanged(nameof(EditorFrontProxy));
        RaisePropertyChanged(nameof(EditorFrontSpansProxy));
        RaisePropertyChanged(nameof(EditorBackSpansProxy));
        RaisePropertyChanged(nameof(EditorTagsProxy));
        RaisePropertyChanged(nameof(RetentionTrendPointsProxy));
        RaisePropertyChanged(nameof(RetentionTrendBarsProxy));
        RaisePropertyChanged(nameof(DeleteCardCommandProxy));
        RaisePropertyChanged(nameof(CancelEditCommandProxy));
        RaisePropertyChanged(nameof(IsBackToTopVisibleProxy));
    }

    private void RaisePropertyChanged(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    private void OnFrontEditorAttached(object? sender, Avalonia.VisualTreeAttachmentEventArgs e) =>
        OnEditorAttached(sender, FlashcardEditorField.Front);

    private void OnBackEditorAttached(object? sender, Avalonia.VisualTreeAttachmentEventArgs e) =>
        OnEditorAttached(sender, FlashcardEditorField.Back);

    private void OnEditorAttached(object? sender, FlashcardEditorField field)
    {
        if (sender is not RichDocumentEditor editor || _viewModel is null)
            return;

        var cardId = editor.Tag as string;
        if (string.IsNullOrWhiteSpace(cardId))
            return;

        var bindings = field == FlashcardEditorField.Front ? _frontEditorBindings : _backEditorBindings;
        if (bindings.TryGetValue(cardId, out var existing) && ReferenceEquals(existing.Editor, editor))
            return;

        if (bindings.TryGetValue(cardId, out var stale))
            DetachEditor(stale);

        var spans = field == FlashcardEditorField.Front ? _viewModel.EditorFrontSpans : _viewModel.EditorBackSpans;
        editor.IsPreviewMode = false;
        editor.LoadSpans(spans);

        var binding = new RichEditorBinding(editor, cardId, field);
        binding.Handler = updatedSpans => OnEditorSpansChanged(binding, updatedSpans);
        editor.SpansChanged += binding.Handler;
        bindings[cardId] = binding;
    }

    private void OnEditorDetached(object? sender, Avalonia.VisualTreeAttachmentEventArgs e)
    {
        if (sender is not RichDocumentEditor editor)
            return;

        foreach (var map in new[] { _frontEditorBindings, _backEditorBindings })
        {
            var stale = map.Where(kvp => ReferenceEquals(kvp.Value.Editor, editor)).Select(kvp => kvp.Key).ToArray();
            foreach (var key in stale)
            {
                DetachEditor(map[key]);
                map.Remove(key);
            }
        }
    }

    private static void DetachEditor(RichEditorBinding binding)
    {
        if (binding.Handler is not null)
            binding.Editor.SpansChanged -= binding.Handler;
    }

    private void OnEditorSpansChanged(RichEditorBinding binding, IReadOnlyList<InlineSpan> spans)
    {
        if (_viewModel is null)
            return;
        if (!string.Equals(_viewModel.ExpandedCardId, binding.CardId, StringComparison.Ordinal))
            return;

        var current = binding.Field == FlashcardEditorField.Front
            ? _viewModel.EditorFrontSpans
            : _viewModel.EditorBackSpans;
        if (SpansEquivalent(current, spans))
            return;

        _viewModel.UpdateEditorSpans(binding.Field, spans);
    }

    private void OnDeckScrollChanged(object? sender, ScrollChangedEventArgs e)
    {
        var next = DeckScrollViewer.Offset.Y > 320;
        if (_isBackToTopVisible == next)
            return;

        _isBackToTopVisible = next;
        RaisePropertyChanged(nameof(IsBackToTopVisibleProxy));
    }

    private void OnBackToTopClick(object? sender, RoutedEventArgs e)
    {
        DeckScrollViewer.Offset = new Vector(DeckScrollViewer.Offset.X, 0);
    }

    private static bool SpansEquivalent(IReadOnlyList<InlineSpan>? left, IReadOnlyList<InlineSpan>? right)
    {
        if (ReferenceEquals(left, right))
            return true;
        if (left is null || right is null || left.Count != right.Count)
            return false;

        for (var i = 0; i < left.Count; i++)
        {
            var l = left[i];
            var r = right[i];
            if (l.GetType() != r.GetType())
                return false;

            switch (l)
            {
                case TextSpan lt when r is TextSpan rt:
                    if (!string.Equals(lt.Text, rt.Text, StringComparison.Ordinal)
                        || !Equals(lt.Style, rt.Style))
                        return false;
                    break;
                case EquationSpan le when r is EquationSpan re:
                    if (!string.Equals(le.Latex, re.Latex, StringComparison.Ordinal)
                        || !Equals(le.Style, re.Style))
                        return false;
                    break;
                case FractionSpan lf when r is FractionSpan rf:
                    if (lf.Numerator != rf.Numerator
                        || lf.Denominator != rf.Denominator
                        || !Equals(lf.Style, rf.Style))
                        return false;
                    break;
                default:
                    return false;
            }
        }

        return true;
    }

    private void OnInsertClozeClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Control source || _viewModel is null || !_viewModel.IsEditorClozeType)
            return;

        var shell = FindShell(source);
        if (shell is null)
            return;

        var frontEditor = shell.GetVisualDescendants()
            .OfType<RichDocumentEditor>()
            .FirstOrDefault(editor => editor.Name == "FrontRichEditor");
        if (frontEditor == null)
            return;

        var nextOrdinal = FlashcardClozeOrdinal.ComputeNext(_viewModel.EditorFront);
        frontEditor.TryWrapSelectionWithCloze(nextOrdinal);
    }

    private static Border? FindShell(Control source) =>
        source.GetVisualAncestors().OfType<Border>().FirstOrDefault(b => b.Classes.Contains("fc-card-editor-shell"));

    private async void OnDeckTransferClick(object? sender, RoutedEventArgs e)
    {
        if (_viewModel is null || string.IsNullOrWhiteSpace(_viewModel.DeckId))
            return;

        var app = Application.Current as App;
        var services = app?.Services;
        if (services == null)
            return;

        var coordinator = services.GetService<IImportExportCoordinator>();
        var overlayService = services.GetService<IOverlayService>();
        if (coordinator == null || overlayService == null)
            return;

        var localization = services.GetService<ILocalizationService>();
        if (localization == null)
            return;

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
            ExportSubtitle = string.IsNullOrWhiteSpace(_viewModel.DeckName)
                ? null
                : string.Format(localization.T("TransferFromFormat", "Flashcards"), _viewModel.DeckName),
            ItemNounSingular = localization.T("TransferNounSingular", "Flashcards"),
            ItemNounPlural = localization.T("TransferNounPlural", "Flashcards"),
            ExportFormats = exportFormats,
            Coordinator = coordinator
        }).ConfigureAwait(true);
        if (choice?.Format == null)
            return;

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel?.StorageProvider == null)
            return;

        var extension = choice.Format.Extensions.FirstOrDefault() ?? ".mnemo";
        var suggestedName = string.IsNullOrWhiteSpace(_viewModel.DeckName) ? "deck" : SanitizeFileName(_viewModel.DeckName);
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
            ? new[] { _viewModel.DeckId }
            : _viewModel.DeckId;
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

    /// <summary>Esc collapses the expanded card; Ctrl+Enter and cloze wrap are handled via the app keymap.</summary>
    private void OnEditorKeyDown(object? sender, KeyEventArgs e)
    {
        if (_viewModel is null)
            return;

        if (e.Key == Key.Escape)
        {
            _viewModel.CloseExpandedCardCommand.Execute(null);
            e.Handled = true;
        }
    }

    private static IReadOnlyList<RetentionTrendBarPoint> BuildRetentionTrendBars(IReadOnlyList<FlashcardRetentionTrendPoint> values)
    {
        if (values.Count == 0)
            return Array.Empty<RetentionTrendBarPoint>();

        var latestReviewedIndex = -1;
        for (var i = values.Count - 1; i >= 0; i--)
        {
            if (values[i].ReviewsCount > 0)
            {
                latestReviewedIndex = i;
                break;
            }
        }

        var result = new RetentionTrendBarPoint[values.Count];
        for (var i = 0; i < values.Count; i++)
        {
            var hasReviews = values[i].ReviewsCount > 0;
            var percent = Math.Clamp(values[i].RetentionPercent, 0, 100);
            var normalizedHeight = (percent / 100d) * RetentionChartMaxBarHeight;
            var height = hasReviews && percent > 0
                ? Math.Max(RetentionChartMinVisibleNonZeroHeight, normalizedHeight)
                : 0d;
            var isLatest = i == latestReviewedIndex;
            result[i] = new RetentionTrendBarPoint(height, percent, values[i].ReviewsCount, hasReviews, isLatest);
        }

        return result;
    }

    private sealed class RichEditorBinding
    {
        public RichEditorBinding(RichDocumentEditor editor, string cardId, FlashcardEditorField field)
        {
            Editor = editor;
            CardId = cardId;
            Field = field;
        }

        public RichDocumentEditor Editor { get; }
        public string CardId { get; }
        public FlashcardEditorField Field { get; }
        public Action<IReadOnlyList<InlineSpan>>? Handler { get; set; }
    }

    public sealed record RetentionTrendBarPoint(double Height, int Percent, int ReviewsCount, bool HasReviews, bool IsLatest);
}
