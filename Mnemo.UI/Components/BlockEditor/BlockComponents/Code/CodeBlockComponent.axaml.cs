using System;
using System.ComponentModel;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Input.Platform;
using Avalonia.Media;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.UI.Services;

namespace Mnemo.UI.Components.BlockEditor.BlockComponents.Code;

public partial class CodeBlockComponent : BlockComponentBase, IBlockEditorReadOnlyChrome
{
    private readonly ITextMateSyntaxHighlighter _syntaxHighlighter;
    private BlockViewModel? _vm;
    private DispatcherTimer? _highlightDebounce;
    private EventHandler? _themeChangedHandler;

    public CodeBlockComponent()
    {
        var services = (Application.Current as App)?.Services;
        _syntaxHighlighter = services?.GetService<ITextMateSyntaxHighlighter>()
                             ?? new TextMateSyntaxHighlighter();

        InitializeComponent();
        WireInputControl(CodeEditor);
        CopyButton.Click += OnCopyClick;
        LanguageCombo.SelectionChanged += OnLanguageComboSelectionChanged;
        CodeEditor.TextChanged += (_, _) =>
        {
            SyncSelectionBackground();
            ScheduleHighlightRefresh();
        };
        CodeEditor.KeyUp += (_, _) => PostSyncSelectionIfAlive();
        CodeEditor.PointerPressed += (_, _) => PostSyncSelectionIfAlive();
        CodeEditor.PointerMoved += OnCodeEditorPointerMovedForSelection;
        CodeEditor.PointerReleased += (_, _) => PostSyncSelectionIfAlive();
        CodeEditor.GotFocus += (_, _) => PostSyncSelectionIfAlive();
        HighlightBlock.LayoutUpdated += (_, _) =>
        {
            SyncEditorMinHeight();
            SyncCodeEditorHostWidth();
        };

        DataContextChanged += OnDataContextChanged;
    }

    /// <summary>Idle <see cref="PointerMoved"/> fires constantly; only sync the selection overlay when the user is actively drag-selecting.</summary>
    private void OnCodeEditorPointerMovedForSelection(object? sender, Avalonia.Input.PointerEventArgs e)
    {
        if (e.GetCurrentPoint(CodeEditor).Properties.IsLeftButtonPressed)
            PostSyncSelectionIfAlive();
    }

    private void PostSyncSelectionIfAlive()
    {
        Dispatcher.UIThread.Post(() =>
        {
            if (VisualRoot is null)
                return;
            SyncSelectionBackground();
        }, DispatcherPriority.Input);
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (Application.Current != null)
        {
            _themeChangedHandler ??= (_, _) => ScheduleHighlightRefresh();
            Application.Current.ActualThemeVariantChanged += _themeChangedHandler;
        }

        LanguageCombo.ItemsSource = CodeLanguageCatalog.GetLanguages();
        SyncLanguageComboFromVm(forceItems: false);
        ScheduleHighlightRefresh();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        LanguageCombo.IsDropDownOpen = false;
        if (Application.Current != null && _themeChangedHandler != null)
            Application.Current.ActualThemeVariantChanged -= _themeChangedHandler;
        _highlightDebounce?.Stop();
        base.OnDetachedFromVisualTree(e);
    }

    public override Control? GetInputControl() => CodeEditor;

    public void ApplyBlockEditorReadOnly(bool readOnly)
    {
        LanguageCombo.IsVisible = !readOnly;
        LanguageReadLabel.IsVisible = readOnly;
        LanguageCombo.IsEnabled = !readOnly;
        CodeEditor.IsVisible = !readOnly;
        CodeEditor.IsReadOnly = readOnly;

        UpdateLanguageReadLabel();
        if (readOnly)
            RefreshHighlightImmediate();
        else
            ScheduleHighlightRefresh();
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_vm != null)
            _vm.PropertyChanged -= OnVmPropertyChanged;

        _vm = DataContext as BlockViewModel;
        if (_vm != null)
            _vm.PropertyChanged += OnVmPropertyChanged;

        SyncLanguageComboFromVm(forceItems: true);
        UpdateLanguageReadLabel();
        ScheduleHighlightRefresh();
    }

    private void OnVmPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(BlockViewModel.CodeLanguage))
        {
            SyncLanguageComboFromVm(forceItems: false);
            UpdateLanguageReadLabel();
            ScheduleHighlightRefresh();
        }
        else if (e.PropertyName == nameof(BlockViewModel.Content))
            ScheduleHighlightRefresh();
    }

    private void SyncLanguageComboFromVm(bool forceItems)
    {
        if (LanguageCombo.ItemsSource == null || forceItems)
            LanguageCombo.ItemsSource = CodeLanguageCatalog.GetLanguages();

        var id = (_vm?.CodeLanguage ?? string.Empty).Trim();
        if (LanguageCombo.ItemsSource is not System.Collections.IEnumerable enumerable)
            return;

        CodeLanguageItem? match = null;
        foreach (var o in enumerable)
        {
            if (o is CodeLanguageItem li && li.Id.Equals(id, StringComparison.OrdinalIgnoreCase))
            {
                match = li;
                break;
            }
        }

        LanguageCombo.SelectionChanged -= OnLanguageComboSelectionChanged;
        LanguageCombo.SelectedItem = match;
        if (match == null && !string.IsNullOrEmpty(id))
            LanguageCombo.SelectedItem = new CodeLanguageItem(id, id);
        LanguageCombo.SelectionChanged += OnLanguageComboSelectionChanged;
    }

    private void OnLanguageComboSelectionChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (_vm == null) return;
        if (LanguageCombo.SelectedItem is CodeLanguageItem li && _vm.CodeLanguage != li.Id)
            _vm.CodeLanguage = li.Id;
    }

    private void CodeScroll_SizeChanged(object? sender, SizeChangedEventArgs e) => SyncCodeEditorHostWidth();

    private void SyncCodeEditorHostWidth()
    {
        if (HighlightBlock == null || CodeEditorHost == null || CodeScroll == null || CodeEditor == null
            || SelectionBackground == null)
            return;

        var tw = HighlightBlock.Bounds.Width;
        if (tw <= 0 || double.IsNaN(tw))
            return;

        var viewport = CodeScroll.Bounds.Width;
        var minW = Math.Max(200, Math.Max(tw, viewport > 1 ? viewport : tw));
        CodeEditorHost.MinWidth = minW;
        CodeEditor.MinWidth = minW;
        SelectionBackground.MinWidth = minW;
    }

    private void UpdateLanguageReadLabel()
    {
        var id = (_vm?.CodeLanguage ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(id))
        {
            LanguageReadLabel.Text = "Plain text";
            return;
        }

        var pick = CodeLanguageCatalog.GetLanguages()
            .FirstOrDefault(x => x.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
        LanguageReadLabel.Text = pick?.Label ?? id.ToUpperInvariant();
    }

    private void ScheduleHighlightRefresh()
    {
        if (_highlightDebounce == null)
        {
            _highlightDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(90) };
            _highlightDebounce.Tick += OnHighlightDebounceTick;
        }
        _highlightDebounce.Stop();
        _highlightDebounce.Start();
    }

    private void OnHighlightDebounceTick(object? sender, EventArgs e)
    {
        _highlightDebounce?.Stop();
        RefreshHighlightImmediate();
    }

    private void RefreshHighlightImmediate()
    {
        var fg = Application.Current?.FindResource("SyntaxCodeDefaultBrush") as IBrush
                 ?? Application.Current?.FindResource("TextPrimaryBrush") as IBrush
                 ?? Brushes.Gainsboro;
        var code = _vm?.Content ?? string.Empty;
        var lang = _vm?.CodeLanguage;
        LineNumbersBlock.Text = SketchSyntaxHighlighter.BuildLineNumberText(code);
        _syntaxHighlighter.ApplyToTextBlock(HighlightBlock, code, lang, fg);
        SyncSelectionBackground();
        SyncEditorMinHeight();
        Dispatcher.UIThread.Post(SyncCodeEditorHostWidth, DispatcherPriority.Loaded);
    }

    private void SyncSelectionBackground()
    {
        if (SelectionBackground == null || CodeEditor == null)
            return;

        // Idempotent, pointer/key events fire constantly; assigning Text reflows the layer.
        var text = CodeEditor.Text ?? string.Empty;
        if (!string.Equals(SelectionBackground.Text, text, StringComparison.Ordinal))
            SelectionBackground.Text = text;
        var selStart = CodeEditor.SelectionStart;
        var selEnd = CodeEditor.SelectionEnd;
        if (SelectionBackground.SelectionStart != selStart)
            SelectionBackground.SelectionStart = selStart;
        if (SelectionBackground.SelectionEnd != selEnd)
            SelectionBackground.SelectionEnd = selEnd;
    }

    private void SyncEditorMinHeight()
    {
        if (!CodeEditor.IsVisible)
            return;
        var h = Math.Max(120, HighlightBlock.Bounds.Height);
        if (h > 0)
            CodeEditor.MinHeight = h;
    }

    private async void OnCopyClick(object? sender, RoutedEventArgs e)
    {
        try
        {
            var top = TopLevel.GetTopLevel(this);
            if (top?.Clipboard != null && _vm != null)
                await top.Clipboard.SetTextAsync(_vm.Content ?? string.Empty);
        }
        catch
        {
            // Clipboard may be unavailable
        }
    }
}
