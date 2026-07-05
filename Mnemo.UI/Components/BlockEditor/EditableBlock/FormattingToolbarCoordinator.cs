using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Components.BlockEditor.FormattingToolbar;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;

namespace Mnemo.UI.Components.BlockEditor;

/// <summary>
/// Manages the formatting-toolbar overlay lifecycle, format state queries, and link dialog
/// for a single <see cref="EditableBlock"/>.
/// Owns <c>_formattingToolbarOverlayId</c>, the debounce timer, and <c>_cachedSelectionRange</c>.
/// </summary>
internal sealed class FormattingToolbarCoordinator
{
    private readonly EditableBlock _host;
    private string? _formattingToolbarOverlayId;
    private InlineFormattingToolbar? _currentFormattingToolbar;
    private TopLevel? _toolbarPointerTopLevel;
    private DispatcherTimer? _formattingToolbarCloseDebounce;

    private const double HeightEstimate = 48;

    internal FormattingToolbarCoordinator(EditableBlock host)
    {
        _host = host;
    }

    internal (int start, int end)? CachedSelectionRange { get; private set; }

    internal void SetCachedSelectionRange((int start, int end)? range) => CachedSelectionRange = range;

    internal void CheckAndToggle()
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        var action = "none";

        var parentEditor = _host.FindParentBlockEditor();

        if (parentEditor?.IsPointerSelecting == true)
        {
            action = "skip-selecting";
            if (perfStart != 0)
                EditorPerfDiagnostics.ReportInteraction(perf, "toolbar.checkSelection", EditorPerfDiagnostics.ElapsedMs(perfStart), $"action={action}");
            return;
        }

        if (_formattingToolbarOverlayId == null)
        {
            var quickRange = _host.GetSelectionRange();
            if (quickRange == null || quickRange.Value.end <= quickRange.Value.start)
            {
                action = "skip-noop";
                if (perfStart != 0)
                    EditorPerfDiagnostics.ReportInteraction(perf, "toolbar.checkSelection", EditorPerfDiagnostics.ElapsedMs(perfStart), $"action={action}");
                return;
            }
        }

        if (parentEditor?.HasCrossBlockTextSelection() == true && _host._viewModel?.IsFocused != true)
        {
            CachedSelectionRange = null;
            Close();
            action = "close-crossBlockOther";
            if (perfStart != 0)
                EditorPerfDiagnostics.ReportInteraction(perf, "toolbar.checkSelection", EditorPerfDiagnostics.ElapsedMs(perfStart), $"action={action}");
            return;
        }

        var range = _host.GetSelectionRange();
        if (range != null && range.Value.end > range.Value.start)
        {
            CachedSelectionRange = range;
            if (_formattingToolbarOverlayId == null)
            {
                action = "show";
                Show();
            }
            else
            {
                action = "update";
                UpdateState();
            }
        }
        else
        {
            CachedSelectionRange = null;
            action = "close-empty";
            Close();
        }

        if (perfStart != 0)
        {
            var len = range.HasValue ? range.Value.end - range.Value.start : 0;
            EditorPerfDiagnostics.ReportInteraction(perf, "toolbar.checkSelection", EditorPerfDiagnostics.ElapsedMs(perfStart), $"action={action} sel={len}");
        }
    }

    internal void OnEditorSelectionChanged()
    {
        var parentEditor = _host.FindParentBlockEditor();
        if (parentEditor?.IsPointerSelecting == true) return;

        var range = _host.GetSelectionRange();
        if (range != null && range.Value.end > range.Value.start)
        {
            CancelCloseDebounce();
            Dispatcher.UIThread.Post(CheckAndToggle, DispatcherPriority.Input);
            return;
        }

        ScheduleCloseDebounce();
    }

    internal void UpdateState()
    {
        if (_currentFormattingToolbar == null || CachedSelectionRange == null || _host._viewModel == null) return;
        var (start, end) = CachedSelectionRange.Value;
        var state = GetFormatStateForRange(_host._viewModel.Spans, start, end);

        bool subActive = _host._formatHandler?.StickySubSup == InlineFormatKind.Subscript || state.subscript;
        bool supActive = _host._formatHandler?.StickySubSup == InlineFormatKind.Superscript || state.superscript;

        _currentFormattingToolbar.UpdateFormatState(
            state.bold, state.italic, state.underline, state.strikethrough,
            state.highlight, state.foregroundColor, state.backgroundColor, state.hasLink,
            subActive, supActive);
        var heading = _host._viewModel.Type is BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4;
        _currentFormattingToolbar.SetBoldButtonEnabled(!heading);
    }

    internal void Close(bool disposeToolbar = false)
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;
        var hadOverlay = !string.IsNullOrEmpty(_formattingToolbarOverlayId);

        CancelCloseDebounce();

        if (!string.IsNullOrEmpty(_formattingToolbarOverlayId) && _host._overlayService != null)
        {
            _host._overlayService.CloseOverlay(_formattingToolbarOverlayId);
            _formattingToolbarOverlayId = null;
            CachedSelectionRange = null;
            DetachOutsideClickHandler();
        }

        if (disposeToolbar && _currentFormattingToolbar != null)
        {
            _currentFormattingToolbar.FormatRequested -= OnFormatRequested;
            _currentFormattingToolbar.ForegroundColorRequested -= OnForegroundColorRequested;
            _currentFormattingToolbar.BackgroundColorRequested -= OnBackgroundColorRequested;
            _currentFormattingToolbar.EquationRequested -= OnEquationRequested;
            _currentFormattingToolbar = null;
        }

        if (perfStart != 0)
            EditorPerfDiagnostics.ReportInteraction(perf, "toolbar.close", EditorPerfDiagnostics.ElapsedMs(perfStart), $"hadOverlay={hadOverlay} dispose={disposeToolbar}");
    }

    internal void OnInlineEquationEdited(int charIndex, string newLatex)
    {
        if (_host._viewModel == null) return;
        var spans = _host._viewModel.Spans.ToList();
        int offset = 0;
        for (int i = 0; i < spans.Count; i++)
        {
            int len = spans[i] is TextSpan t ? t.Text.Length : 1;
            int runEnd = offset + len;
            if (charIndex >= offset && charIndex < runEnd && spans[i] is EquationSpan eq)
            {
                spans[i] = eq with { Latex = newLatex };
                _host._viewModel.CommitSpansFromEditor(spans);
                var editor = _host._currentBlockComponent?.GetRichTextEditor();
                if (editor != null)
                    editor.Spans = _host._viewModel.Spans;
                return;
            }
            offset = runEnd;
        }
    }

    internal async Task HandleLinkShortcutAsync(RichTextEditor editor)
    {
        var blockEditor = _host.FindParentBlockEditor();
        if (blockEditor == null || _host._viewModel == null) return;

        if (blockEditor.HasCrossBlockTextSelection())
        {
            await HandleLinkFormatRequestedAsync(expandWordWhenNoSelection: false);
            return;
        }

        if (_host.GetSelectionRange() == null)
        {
            var span = TryGetContiguousLinkSpanAtCaret(editor, _host._viewModel.Spans);
            if (span == null) return;
            editor.SelectionStart = span.Value.start;
            editor.SelectionEnd = span.Value.end;
            editor.CaretIndex = span.Value.end;
            CachedSelectionRange = (span.Value.start, span.Value.end);
        }

        await HandleLinkFormatRequestedAsync(expandWordWhenNoSelection: false);
    }

    internal async Task HandleLinkFormatRequestedAsync(bool expandWordWhenNoSelection = true)
    {
        var blockEditor = _host.FindParentBlockEditor();
        var editor = _host._currentBlockComponent?.GetRichTextEditor() ?? _host._focusManager?.GetCurrentTextBox();

        if (editor != null && blockEditor?.HasCrossBlockTextSelection() != true && _host._viewModel != null)
        {
            if (_host.GetSelectionRange() == null && CachedSelectionRange == null)
            {
                var linkSpan = TryGetContiguousLinkSpanAtCaret(editor, _host._viewModel.Spans);
                if (linkSpan != null)
                {
                    editor.SelectionStart = linkSpan.Value.start;
                    editor.SelectionEnd = linkSpan.Value.end;
                    editor.CaretIndex = linkSpan.Value.end;
                    CachedSelectionRange = (linkSpan.Value.start, linkSpan.Value.end);
                }
                else if (expandWordWhenNoSelection)
                {
                    var word = editor.TryGetWordRangeAtCaret();
                    if (word != null)
                    {
                        editor.SelectionStart = word.Value.Start;
                        editor.SelectionEnd = word.Value.End;
                        editor.CaretIndex = word.Value.End;
                        CachedSelectionRange = (word.Value.Start, word.Value.End);
                    }
                }
            }
        }

        if (blockEditor?.HasCrossBlockTextSelection() == true)
        {
            bool hasLink = blockEditor.CrossBlockTextSelectionHasLink();
            string? crossUrl = hasLink ? blockEditor.TryGetFirstLinkUrlInCrossBlockSelection() : null;
            var result = await ShowLinkEditDialogAsync(
                initialUrl: crossUrl ?? string.Empty,
                initialDisplay: string.Empty,
                showDisplaySection: false,
                showCrossBlockHint: true,
                showRemoveLink: hasLink,
                wasEditingLink: hasLink,
                titleKey: hasLink ? "EditLinkTitle" : "InsertLinkTitle");
            if (result == null) return;
            if (result.RemoveLinkRequested)
            {
                _host._formatHandler?.Apply(InlineFormatKind.Link, null);
                return;
            }
            if (string.IsNullOrWhiteSpace(result.Url)) return;
            _host._formatHandler?.Apply(InlineFormatKind.Link, NormalizeUrlInput(result.Url.Trim()));
            return;
        }

        var range = _host.GetSelectionRange() ?? CachedSelectionRange;
        if (range == null || _host._viewModel == null) return;

        var flat = InlineSpanFormatApplier.Flatten(_host._viewModel.Spans);
        var (a, b) = range.Value;
        if (a >= b || b > flat.Length) return;
        string selectedText = flat.Substring(a, b - a);
        bool hasLinkSel = GetFormatStateForRange(_host._viewModel.Spans, a, b).hasLink;
        string? initialUrl = hasLinkSel ? GetLinkUrlForRange(_host._viewModel.Spans, a, b) : null;

        var dlgResult = await ShowLinkEditDialogAsync(
            initialUrl: initialUrl ?? string.Empty,
            initialDisplay: selectedText,
            showDisplaySection: true,
            showCrossBlockHint: false,
            showRemoveLink: hasLinkSel,
            wasEditingLink: hasLinkSel,
            titleKey: hasLinkSel ? "EditLinkTitle" : "InsertLinkTitle");
        if (dlgResult == null) return;

        if (dlgResult.RemoveLinkRequested)
        {
            _host._formatHandler?.Apply(InlineFormatKind.Link, null);
            return;
        }
        if (string.IsNullOrWhiteSpace(dlgResult.Url))
        {
            if (hasLinkSel)
                _host._formatHandler?.Apply(InlineFormatKind.Link, null);
            return;
        }

        var normalized = NormalizeUrlInput(dlgResult.Url.Trim());
        CommitSingleBlockLinkApply(range.Value, dlgResult.DisplayText, normalized);
    }

    internal async Task OnExternalLinkNavigationRequestedAsync(string url)
    {
        if (await ConfirmExternalNavigationAsync(url))
            RichTextEditor.OpenExternalUrl(url, _host);
    }

    private void Show()
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;

        var textBox = _host._currentBlockComponent?.GetRichTextEditor() ?? _host._focusManager?.GetCurrentTextBox();
        if (_host._overlayService == null || textBox == null || !textBox.IsVisible) return;

        if (!string.IsNullOrEmpty(_formattingToolbarOverlayId))
        {
            UpdateState();
            if (perfStart != 0)
                EditorPerfDiagnostics.ReportInteraction(perf, "toolbar.show", EditorPerfDiagnostics.ElapsedMs(perfStart), "existingOverlay=1");
            return;
        }

        var toolbar = _currentFormattingToolbar;
        if (toolbar == null)
        {
            toolbar = new InlineFormattingToolbar();
            toolbar.FormatRequested += OnFormatRequested;
            toolbar.ForegroundColorRequested += OnForegroundColorRequested;
            toolbar.BackgroundColorRequested += OnBackgroundColorRequested;
            toolbar.EquationRequested += OnEquationRequested;
            _currentFormattingToolbar = toolbar;
        }

        bool showAbove = ShouldShowAbove(textBox);
        var options = new OverlayOptions
        {
            ShowBackdrop = false,
            CloseOnOutsideClick = true,
            AnchorOffset = showAbove ? new Thickness(0, -8, 0, 0) : new Thickness(0, 4, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top
        };

        if (textBox is RichTextEditor rte)
        {
            var selBounds = rte.GetSelectionBounds();
            var topLevel = textBox.FindAncestorOfType<TopLevel>();
            if (selBounds is { } rect && topLevel != null)
            {
                var centerX = rect.X + rect.Width / 2;
                var ptCenter = textBox.TranslatePoint(new Point(centerX, 0), topLevel);
                var ptTop = textBox.TranslatePoint(new Point(0, rect.Top), topLevel);
                var ptBottom = textBox.TranslatePoint(new Point(0, rect.Bottom), topLevel);
                if (ptCenter.HasValue && ptTop.HasValue && ptBottom.HasValue)
                {
                    options.AnchorPointX = ptCenter.Value.X;
                    options.AnchorPointY = showAbove ? ptTop.Value.Y : ptBottom.Value.Y;
                    options.AnchorPosition = showAbove ? AnchorPosition.TopCenter : AnchorPosition.BottomCenter;
                }
            }
        }

        if (!options.AnchorPointX.HasValue)
        {
            options.AnchorControl = textBox;
            options.AnchorPosition = showAbove ? AnchorPosition.TopLeft : AnchorPosition.BottomLeft;
        }

        _formattingToolbarOverlayId = _host._overlayService.CreateOverlay(toolbar, options, "InlineFormattingToolbar");
        toolbar.SetHostingToolbarOverlayId(_formattingToolbarOverlayId);
        AttachOutsideClickHandler(textBox);
        Dispatcher.UIThread.Post(UpdateState, DispatcherPriority.Loaded);

        if (perfStart != 0)
            EditorPerfDiagnostics.ReportInteraction(perf, "toolbar.show", EditorPerfDiagnostics.ElapsedMs(perfStart), $"existingToolbar={(toolbar == _currentFormattingToolbar ? 1 : 0)} above={showAbove}");
    }

    private void OnFormatRequested(InlineFormatKind kind)
    {
        if (kind == InlineFormatKind.Link)
        {
            _ = HandleLinkFormatRequestedAsync();
            return;
        }

        if (kind is InlineFormatKind.Subscript or InlineFormatKind.Superscript)
        {
            var editor = _host._currentBlockComponent?.GetRichTextEditor() ?? _host._focusManager?.GetCurrentTextBox();
            if (editor != null)
                _host._formatHandler?.HandleSubSupShortcut(editor, kind);
            return;
        }

        string? color = null;
        if (kind == InlineFormatKind.Highlight
            && Avalonia.Application.Current?.TryFindResource("InlineHighlightColor", out var res) == true
            && res is Color c)
            color = $"#{c.R:X2}{c.G:X2}{c.B:X2}";
        _host._formatHandler?.Apply(kind, color);
    }

    private void OnForegroundColorRequested(string? colorOrSwatch)
        => _host._formatHandler?.Apply(InlineFormatKind.ForegroundColor, colorOrSwatch);

    private void OnBackgroundColorRequested(string? colorOrSwatch)
        => _host._formatHandler?.Apply(InlineFormatKind.BackgroundColor, colorOrSwatch);

    private void OnEquationRequested()
        => _host._formatHandler?.ApplyInlineEquation();

    private void CommitSingleBlockLinkApply((int start, int end) range, string displayText, string normalizedUrl)
    {
        var editor = _host._currentBlockComponent?.GetRichTextEditor() ?? _host._focusManager?.GetCurrentTextBox();
        if (editor == null || _host._viewModel == null) return;

        var (newStart, newEnd) = _host._viewModel.ApplyLinkEdit(range.start, range.end, displayText, normalizedUrl, removeLink: false);

        _host._stateManager?.SetUpdatingFromViewModel();
        editor.Spans = _host._viewModel.Spans;
        editor.SelectionStart = newStart;
        editor.SelectionEnd = newEnd;
        editor.CaretIndex = newEnd;
        if (_host._stateManager != null)
            _host._stateManager.PreviousText = _host._viewModel.Content;
        _host._stateManager?.SetNormal();
        CachedSelectionRange = (newStart, newEnd);
        UpdateState();
        editor.Focus();
    }

    private Task<LinkEditDialogResult?> ShowLinkEditDialogAsync(
        string initialUrl, string initialDisplay, bool showDisplaySection,
        bool showCrossBlockHint, bool showRemoveLink, bool wasEditingLink, string titleKey)
    {
        var tcs = new TaskCompletionSource<LinkEditDialogResult?>();
        var overlaySvc = _host._overlayService ?? (Avalonia.Application.Current as App)?.Services?.GetService<IOverlayService>();
        if (overlaySvc == null) { tcs.SetResult(null); return tcs.Task; }

        var loc = (Avalonia.Application.Current as App)?.Services?.GetService<ILocalizationService>();
        string T(string key, string ns = "NotesEditor") => loc?.T(key, ns) ?? key;

        var dialog = new LinkInsertDialogOverlay
        {
            Title = T(titleKey),
            UrlLabel = T("InsertLinkUrlLabel"),
            Url = initialUrl,
            UrlPlaceholder = T("InsertLinkUrlPlaceholder"),
            DisplayLabel = T("InsertLinkDisplayLabel"),
            DisplayText = initialDisplay,
            DisplayPlaceholder = T("InsertLinkDisplayPlaceholder"),
            ShowDisplaySection = showDisplaySection,
            ShowCrossBlockHint = showCrossBlockHint,
            CrossBlockHint = showCrossBlockHint ? T("CrossBlockLinkHint") : null,
            ShowRemoveLink = showRemoveLink,
            RemoveLinkText = T("InsertLinkRemoveLink"),
            ConfirmText = loc?.T("OK", "Common") ?? "OK",
            CancelText = loc?.T("Cancel", "Common") ?? "Cancel",
            RequireUrlForConfirm = !wasEditingLink
        };

        var id = overlaySvc.CreateOverlay(dialog, new OverlayOptions
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true,
            CloseOnEscape = true
        }, "LinkInsert");

        dialog.OnResult = result => { overlaySvc.CloseOverlay(id); tcs.TrySetResult(result); };

        return tcs.Task;
    }

    private async Task<bool> ConfirmExternalNavigationAsync(string url)
    {
        var overlaySvc = _host._overlayService ?? (Avalonia.Application.Current as App)?.Services?.GetService<IOverlayService>();
        if (overlaySvc == null) return true;

        var loc = (Avalonia.Application.Current as App)?.Services?.GetService<ILocalizationService>();
        string T(string key, string ns = "NotesEditor") => loc?.T(key, ns) ?? key;
        var continueLabel = loc?.T("Continue", "Common") ?? "Continue";
        var cancelLabel = loc?.T("Cancel", "Common") ?? "Cancel";

        var tcs = new TaskCompletionSource<bool>();
        var dialog = new DialogOverlay
        {
            Title = T("ExternalLinkTitle"),
            Description = string.Format(T("ExternalLinkMessage"), url),
            PrimaryText = continueLabel,
            SecondaryText = cancelLabel
        };

        var id = overlaySvc.CreateOverlay(dialog, new OverlayOptions
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = false,
            CloseOnEscape = true
        }, "ExternalLinkConfirm");

        dialog.OnChoose = choice =>
        {
            overlaySvc.CloseOverlay(id);
            tcs.TrySetResult(string.Equals(choice, continueLabel, StringComparison.Ordinal));
        };

        return await tcs.Task;
    }

    private void AttachOutsideClickHandler(Control anchorTextBox)
    {
        DetachOutsideClickHandler();
        _toolbarPointerTopLevel = TopLevel.GetTopLevel(anchorTextBox);
        _toolbarPointerTopLevel?.AddHandler(InputElement.PointerPressedEvent, OnTopLevelPointerPressed, RoutingStrategies.Tunnel);
    }

    private void DetachOutsideClickHandler()
    {
        if (_toolbarPointerTopLevel != null)
        {
            _toolbarPointerTopLevel.RemoveHandler(InputElement.PointerPressedEvent, OnTopLevelPointerPressed);
            _toolbarPointerTopLevel = null;
        }
    }

    private void OnTopLevelPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (_formattingToolbarOverlayId == null || _currentFormattingToolbar == null) return;
        if (_currentFormattingToolbar.IsEventFromToolbarOverlay(e.Source)) return;

        var editor = _host._currentBlockComponent?.GetRichTextEditor() ?? _host._focusManager?.GetCurrentTextBox();
        if (editor != null && e.Source is Visual sourceVisual && IsDescendantOf(sourceVisual, editor)) return;

        Close();
    }

    internal void CancelCloseDebounce()
    {
        if (_formattingToolbarCloseDebounce == null) return;
        _formattingToolbarCloseDebounce.Stop();
        _formattingToolbarCloseDebounce.Tick -= OnCloseDebounceTick;
    }

    private void ScheduleCloseDebounce()
    {
        _formattingToolbarCloseDebounce ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(80) };
        _formattingToolbarCloseDebounce.Stop();
        _formattingToolbarCloseDebounce.Tick -= OnCloseDebounceTick;
        _formattingToolbarCloseDebounce.Tick += OnCloseDebounceTick;
        _formattingToolbarCloseDebounce.Start();
    }

    private void OnCloseDebounceTick(object? sender, EventArgs e)
    {
        CancelCloseDebounce();
        CheckAndToggle();
    }

    internal bool IsInteractingWithToolbar => _currentFormattingToolbar?.IsInteractingWithToolbar == true;
    internal bool IsOpen => _formattingToolbarOverlayId != null;

    private static bool ShouldShowAbove(Control textBox)
    {
        if (!textBox.IsVisible) return true;

        var scrollViewer = textBox.FindAncestorOfType<ScrollViewer>();
        double anchorTop;

        if (scrollViewer != null && scrollViewer.Content is Visual scrollContent)
        {
            var ptInContent = textBox.TranslatePoint(new Point(0, 0), scrollContent);
            if (!ptInContent.HasValue) return true;
            double visibleTop = scrollViewer.Offset.Y;
            anchorTop = ptInContent.Value.Y;
            return (anchorTop - visibleTop) >= HeightEstimate;
        }

        var topLevel = textBox.FindAncestorOfType<TopLevel>();
        if (topLevel == null) return true;
        var ptInWindow = textBox.TranslatePoint(new Point(0, 0), topLevel);
        if (!ptInWindow.HasValue) return true;
        return ptInWindow.Value.Y >= HeightEstimate;
    }

    private static bool IsDescendantOf(Visual source, Visual ancestor)
    {
        Visual? current = source;
        while (current != null)
        {
            if (ReferenceEquals(current, ancestor)) return true;
            current = current.GetVisualParent();
        }
        return false;
    }

    internal static (bool bold, bool italic, bool underline, bool strikethrough, bool highlight,
        string? foregroundColor, string? backgroundColor, bool hasLink, bool subscript, bool superscript)
        GetFormatStateForRange(IReadOnlyList<InlineSpan> runs, int start, int end)
    {
        if (runs.Count == 0 || start >= end) return (false, false, false, false, false, null, null, false, false, false);
        bool bold = true, italic = true, underline = true, strikethrough = true, highlight = true;
        bool subscript = true, superscript = true;
        string? foregroundColor = null;
        string? backgroundColor = null;
        bool foregroundMixed = false;
        bool backgroundMixed = false;
        bool anyOverlap = false;
        bool hasLink = false;
        int pos = 0;
        foreach (var seg in runs)
        {
            if (seg is not TextSpan run) { pos += 1; continue; }
            int runEnd = pos + run.Text.Length;
            if (runEnd <= start || pos >= end) { pos = runEnd; continue; }
            anyOverlap = true;
            if (!run.Style.Bold) bold = false;
            if (!run.Style.Italic) italic = false;
            if (!run.Style.Underline) underline = false;
            if (!run.Style.Strikethrough) strikethrough = false;
            if (!run.Style.Highlight) highlight = false;
            if (!run.Style.Subscript) subscript = false;
            if (!run.Style.Superscript) superscript = false;
            if (!foregroundMixed && run.Style.ForegroundColor != null)
            {
                if (foregroundColor == null) foregroundColor = run.Style.ForegroundColor;
                else if (foregroundColor != run.Style.ForegroundColor) { foregroundColor = null; foregroundMixed = true; }
            }
            if (!backgroundMixed && run.Style.BackgroundColor != null)
            {
                if (backgroundColor == null) backgroundColor = run.Style.BackgroundColor;
                else if (backgroundColor != run.Style.BackgroundColor) { backgroundColor = null; backgroundMixed = true; }
            }
            if (run.Style.LinkUrl != null) hasLink = true;
            pos = runEnd;
        }
        if (!anyOverlap) return (false, false, false, false, false, null, null, false, false, false);
        return (bold, italic, underline, strikethrough, highlight, foregroundColor, backgroundColor, hasLink, subscript, superscript);
    }

    private static string? GetLinkUrlForRange(IReadOnlyList<InlineSpan> runs, int start, int end)
    {
        int pos = 0;
        foreach (var seg in runs)
        {
            if (seg is not TextSpan run) { pos += 1; continue; }
            int re = pos + run.Text.Length;
            if (re > start && pos < end && run.Style.LinkUrl != null) return run.Style.LinkUrl;
            pos = re;
        }
        return null;
    }

    private static (int start, int end)? TryGetContiguousLinkSpanAtCaret(RichTextEditor editor, IReadOnlyList<InlineSpan> runs)
    {
        var flatLen = InlineSpanFormatApplier.Flatten(runs).Length;
        if (flatLen == 0) return null;
        int caret = Math.Clamp(editor.CaretIndex, 0, flatLen);
        int idx = caret >= flatLen ? flatLen - 1 : caret;
        string? url = GetLinkUrlAtCharIndex(runs, idx);
        if (string.IsNullOrEmpty(url)) return null;
        int s = idx;
        while (s > 0 && string.Equals(GetLinkUrlAtCharIndex(runs, s - 1), url, StringComparison.OrdinalIgnoreCase))
            s--;
        int end = idx + 1;
        while (end < flatLen && string.Equals(GetLinkUrlAtCharIndex(runs, end), url, StringComparison.OrdinalIgnoreCase))
            end++;
        return (s, end);
    }

    private static string? GetLinkUrlAtCharIndex(IReadOnlyList<InlineSpan> runs, int index)
    {
        int pos = 0;
        foreach (var seg in runs)
        {
            int len = seg is TextSpan t ? t.Text.Length : 1;
            int end = pos + len;
            if (index < end && index >= pos)
                return seg is TextSpan tx ? tx.Style.LinkUrl : null;
            pos = end;
        }
        return null;
    }

    private static string NormalizeUrlInput(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return input;
        if (Uri.TryCreate(input, UriKind.Absolute, out var abs)) return abs.ToString();
        if (input.Contains('@', StringComparison.Ordinal) && !input.Contains("://", StringComparison.Ordinal))
            return "mailto:" + input;
        if (!input.Contains("://", StringComparison.Ordinal))
            return "https://" + input;
        return input;
    }
}
