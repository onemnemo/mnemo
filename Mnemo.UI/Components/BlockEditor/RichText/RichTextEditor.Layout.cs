using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Media.TextFormatting;
using Avalonia.Utilities;
using Avalonia.Threading;
using Avalonia.Layout;
using Avalonia.Rendering;
using Avalonia.VisualTree;
using Avalonia.Controls.Primitives.PopupPositioning;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.LaTeX;
using Mnemo.Infrastructure.Services.TextShortcuts;
using Mnemo.UI.Controls;
using Mnemo.UI;
using Mnemo.UI.Services;
using Mnemo.UI.Services.LaTeX.Layout.Boxes;
using Mnemo.UI.Services.LaTeX.Rendering;

namespace Mnemo.UI.Components.BlockEditor;

public partial class RichTextEditor
{
    // ── Layout ───────────────────────────────────────────────────────────────

    private const double MinLayoutWidth = 200;
    /// <summary>Max width when measure is unconstrained; avoids infinite desired size and layout loops.</summary>
    private const double MaxLayoutWidth = 4096;
    /// <summary>Font size ratio for subscript and superscript text relative to the base font size.</summary>
    private const double SubSuperscriptFontSizeRatio = 0.75;

    /// <summary>
    /// Width for <see cref="BuildLayout"/> / hit-test sync after a layout pass has settled.
    /// Uses <see cref="Bounds.Width"/> (set by ArrangeOverride) and <see cref="_lastLayoutWidth"/>
    /// (set momentarily during arrange before BuildLayout resets it).
    ///
    /// NOTE: Do NOT include the visual parent's Bounds.Width here. When the RichTextEditor sits in
    /// the inner <c>*</c> column of a multi-column block (numbered list, bullet list, checklist,
    /// quote …), the parent Grid is the full block width while the editor is only the narrower
    /// <c>*</c> column. Taking the max with the parent width causes EnsureLayoutForVerticalNavigation
    /// to rebuild the text layout at the wrong (wider) width on the first pointer hit-test, making
    /// text reflow wider than the actual column on click.
    /// </summary>
    private double ComputeEffectiveLayoutMaxWidth()
    {
        var wSelf = Bounds.Width > 0 && !double.IsNaN(Bounds.Width) ? Bounds.Width : 0;
        var wArrange = _lastLayoutWidth > 0 && !double.IsNaN(_lastLayoutWidth) ? _lastLayoutWidth : 0;
        var m = Math.Max(wSelf, wArrange);
        if (m <= 0)
            return MinLayoutWidth;
        return Math.Min(MaxLayoutWidth, m);
    }

    protected override Size MeasureOverride(Size availableSize)
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;

        // Never use infinite width: causes huge desired size and can trigger infinite layout loop.
        var maxWidth = availableSize.Width > 0 && !double.IsInfinity(availableSize.Width)
            ? availableSize.Width : MaxLayoutWidth;
        BuildLayout(maxWidth);
        var textH = _textLayout?.Height ?? FontSize;
        var textW = _textLayout?.Width ?? MinLayoutWidth;
        var height = textH + _mathPadTop + _mathPadBottom;
        var intrinsicW = textW + _mathPadLeft + _mathPadRight;
        var width = double.IsInfinity(availableSize.Width) || availableSize.Width <= 0
            ? Math.Max(MinLayoutWidth, Math.Min(MaxLayoutWidth, intrinsicW))
            : availableSize.Width;
        if (perfStart != 0)
        {
            EditorPerfDiagnostics.ReportInteraction(
                perf,
                "richText.measure",
                EditorPerfDiagnostics.ElapsedMs(perfStart),
                $"text={TextLength} width={maxWidth:0.#}");
        }
        return new Size(width, height);
    }

    protected override Size ArrangeOverride(Size finalSize)
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;

        var layoutWidth = finalSize.Width > 0 ? finalSize.Width : MinLayoutWidth;
        _lastLayoutWidth = layoutWidth;
        BuildLayout(layoutWidth);
        if (perfStart != 0)
        {
            EditorPerfDiagnostics.ReportInteraction(
                perf,
                "richText.arrange",
                EditorPerfDiagnostics.ElapsedMs(perfStart),
                $"text={TextLength} width={layoutWidth:0.#}");
        }
        return finalSize;
    }

    private void BuildLayout(double maxWidth)
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;

        if (maxWidth <= 0 || double.IsNaN(maxWidth))
            maxWidth = MinLayoutWidth;

        // Skip rebuild when text and width are unchanged (e.g. ArrangeOverride fires immediately after
        // MeasureOverride with the same width; this is the most common layout cycle for non-equation blocks).
        // Equations bypass the cache because their reserve-width is re-clamped after layout settles.
        if (_textLayout != null
            && !_hasEquationSpans
            && Math.Abs(_lastLayoutWidth - maxWidth) < 0.5
            && _lastBuiltText == FlattenRuns(Spans ?? Array.Empty<InlineSpan>()))
        {
            if (perfStart != 0)
                EditorPerfDiagnostics.ReportInteraction(perf, "richText.buildLayout.cached", 0,
                    $"text={TextLength} width={maxWidth:0.#}");
            return;
        }

        DisposeLayouts();

        var runs = Spans ?? Array.Empty<InlineSpan>();
        var text = FlattenRuns(runs);
        // Use an explicit opaque brush so text is always visible (theme/resolution can make DynamicResource brush wrong at measure time).
        var foreground = Foreground ?? GetThemeForeground();
        if (foreground?.Opacity == 0)
            foreground = new SolidColorBrush(Colors.Black);
        var typeface = new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight);

        if (string.IsNullOrEmpty(text))
        {
            // Empty; still build a zero-char layout so HitTest works
            _textLayout = new TextLayout(
                string.Empty, typeface, FontSize, foreground,
                TextAlignment.Left, TextWrapping.Wrap, TextTrimming.None,
                null, FlowDirection.LeftToRight, maxWidth);

            // Watermark
            var wmText = Watermark ?? string.Empty;
            if (!string.IsNullOrEmpty(wmText))
            {
                _watermarkLayout = new TextLayout(
                    wmText, typeface, FontSize,
                    new SolidColorBrush(Colors.Gray, 0.5),
                    TextAlignment.Left, TextWrapping.Wrap, TextTrimming.None,
                    null, FlowDirection.LeftToRight, maxWidth);
            }
            _lastBuiltText = string.Empty;
            _lastLayoutWidth = maxWidth;
            _layoutBoundaryAtLogical = new int[] { 0 };
            _layoutTextLength = 0;
            _backgroundLayout = null;
            if (perfStart != 0)
            {
                EditorPerfDiagnostics.ReportInteraction(
                    perf,
                    "richText.buildLayout",
                    EditorPerfDiagnostics.ElapsedMs(perfStart),
                    $"text=0 spans={runs.Count} width={maxWidth:0.#} bg=0");
            }
            return;
        }

        // Ensure non-null opaque foreground so glyphs are always drawn.
        var safeForeground = foreground ?? new SolidColorBrush(Colors.Black);
        if (safeForeground.Opacity == 0)
            safeForeground = new SolidColorBrush(Colors.Black);

        var (layoutText, backgroundSpans, foregroundSpans, boundaries, hasInlineBackground) =
            BuildExpandedLayoutText(runs, text.Length, safeForeground, typeface);
        _layoutBoundaryAtLogical = boundaries;
        _layoutTextLength = layoutText.Length;

        _textLayout = new TextLayout(
            layoutText, typeface, FontSize, safeForeground,
            TextAlignment.Left, TextWrapping.Wrap, TextTrimming.None,
            null, FlowDirection.LeftToRight, maxWidth,
            double.PositiveInfinity, double.NaN, 0, 0,
            null,
            foregroundSpans.Count > 0 ? foregroundSpans : null);

        // 2× layout cost per block was paid even when no run had a background/highlight.
        // For the typical plain-text block this halves the per-block TextLayout count
        // (matters most at load: 1500 blocks × 2 layouts → 1500).
        _backgroundLayout = hasInlineBackground
            ? new TextLayout(
                layoutText, typeface, FontSize, Brushes.Transparent,
                TextAlignment.Left, TextWrapping.Wrap, TextTrimming.None,
                null, FlowDirection.LeftToRight, maxWidth,
                double.PositiveInfinity, double.NaN, 0, 0,
                null,
                backgroundSpans.Count > 0 ? backgroundSpans : null)
            : null;
        _lastBuiltText = text;
        _lastLayoutWidth = maxWidth;

        // Underline geometry references TextLayout hit-test results; must be recomputed
        // whenever the layout changes (new text, width, or after DisposeLayouts).
        RebuildSpellcheckGeometry();

        if (perfStart != 0)
        {
            EditorPerfDiagnostics.ReportInteraction(
                perf,
                "richText.buildLayout",
                EditorPerfDiagnostics.ElapsedMs(perfStart),
                $"text={text.Length} spans={runs.Count} width={maxWidth:0.#} bg={(hasInlineBackground ? 1 : 0)}");
        }
    }

    /// <summary>Layout string uses spaces to reserve measured inline-math width (Notion-style flow).</summary>
    private (string LayoutText, List<ValueSpan<TextRunProperties>> BackgroundSpans, List<ValueSpan<TextRunProperties>> ForegroundSpans, int[] Boundaries, bool HasInlineBackground) BuildExpandedLayoutText(
        IReadOnlyList<InlineSpan> docSpans,
        int logicalLen,
        IBrush defaultForeground,
        Typeface defaultTypeface)
        => RichTextLayoutBuilder.BuildExpandedLayoutText(
            docSpans, logicalLen, defaultForeground, defaultTypeface, FontSize,
            (logicalIdx, placeholderAdv) => GetEquationTargetWidth(logicalIdx, placeholderAdv));

    private static double MeasureTextLayoutWidth(string text, Typeface typeface, IBrush fg, double fontSize)
        => RichTextLayoutBuilder.MeasureTextWidth(text, typeface, fg, fontSize);

    private double MeasureRunTextWidth(string text, Typeface typeface, IBrush fg)
        => RichTextLayoutBuilder.MeasureTextWidth(text, typeface, fg, FontSize);

    private static IBrush ForegroundForTextMeasurement(IBrush defaultForeground)
        => RichTextLayoutBuilder.NormalizeForegroundForMeasurement(defaultForeground);

    private double GetEquationTargetWidth(int logicalCharIndex, double placeholderAdvance)
    {
        var lineCap = _lastLayoutWidth > 0 ? _lastLayoutWidth : (Bounds.Width > 0 ? Bounds.Width : MinLayoutWidth);
        var entries = _equations?.Entries;
        if (entries != null)
        {
            foreach (var eq in entries)
            {
                if (eq.CharIndex == logicalCharIndex && eq.Width > 0)
                    return ClampInlineEquationReserveWidth(eq.Width, eq.Latex ?? string.Empty, FontSize, lineCap);
            }
        }
        return placeholderAdvance;
    }

    /// <summary>Minimal number of spaces so measured width ≥ target.</summary>
    private int GetMinimalSpaceCountForTargetWidth(double targetWidth, Typeface typeface, IBrush fg)
        => RichTextLayoutBuilder.MinSpaceCountForWidth(targetWidth, typeface, fg, FontSize);

    private int LogicalCaretToLayoutBoundary(int logicalCaret)
        => _layoutBoundaryAtLogical != null
            ? RichTextLayoutBuilder.LogicalCaretToLayoutBoundary(_layoutBoundaryAtLogical, logicalCaret)
            : 0;

    private int LayoutBoundaryIndexToLogicalCaret(int layoutBoundaryIndex)
        => _layoutBoundaryAtLogical != null
            ? RichTextLayoutBuilder.LayoutBoundaryIndexToLogicalCaret(_layoutBoundaryAtLogical, layoutBoundaryIndex)
            : 0;

    private void OnSpansChanged()
    {
        var perf = EditorPerfDiagnostics.Resolve();
        var perfStart = perf is { IsEnabled: true } ? Stopwatch.GetTimestamp() : 0;

        // Cache "has any equation span?" once per Spans assignment so the per-keystroke path
        // skips both the LINQ Any scan and the second async equation rebuild when no equations exist.
        var runs = Spans;
        bool hasEq = false;
        if (runs != null)
        {
            int n = runs.Count;
            for (int i = 0; i < n; i++)
            {
                if (runs[i] is EquationSpan) { hasEq = true; break; }
            }
        }
        _hasEquationSpans = hasEq;
        _cachedFlatText = null;

        if (_equations != null) _equations.IsDirty = true;
        InvalidateLayout();
        var len = TextLength;
        if (_caretIndex > len) CaretIndex = len;
        int selMax = SelectionIndexUpperBound;
        if (_selectionStart > selMax) SelectionStart = selMax;
        if (_selectionEnd > selMax) SelectionEnd = selMax;
        RaiseEvent(new TextChangedEventArgs(TextChangedEvent));

        if (hasEq)
        {
            _ = RebuildInlineEquationsAsync();
            Dispatcher.UIThread.Post(() =>
            {
                if (_equations != null) _equations.IsDirty = true;
                _ = RebuildInlineEquationsAsync();
            }, DispatcherPriority.Loaded);
        }
        else
        {
            if (_equations != null)
            {
                _equations.IsDirty = false;
            }
        }

        ScheduleSpellcheck();

        if (perfStart != 0)
            EditorPerfDiagnostics.RecordIfSlow(perf, "spansChanged", EditorPerfDiagnostics.ElapsedMs(perfStart));
    }

    private void InvalidateLayout()
    {
        DisposeLayouts();
        InvalidateMeasure();
        InvalidateVisual();
    }

    private void DisposeLayouts()
    {
        _backgroundLayout?.Dispose();
        _backgroundLayout = null;
        _textLayout?.Dispose();
        _textLayout = null;
        _watermarkLayout?.Dispose();
        _watermarkLayout = null;
        _lastBuiltText = null;
        _lastLayoutWidth = 0;
        _layoutBoundaryAtLogical = null;
        _layoutTextLength = 0;
        _spellcheck?.InvalidateGeometry();
    }

    private bool ShouldDrawWatermark() =>
        string.IsNullOrEmpty(Text)
        && _watermarkLayout != null
        && (IsFocused || IsPointerOver || ShowInactiveWatermark);

    private static IBrush GetThemeForeground() => RichTextThemeBrushes.GetThemeForeground();
    private static IBrush GetThemeSelectionBrush() => RichTextThemeBrushes.GetThemeSelectionBrush();
    private static IBrush GetThemeCaretBrush() => RichTextThemeBrushes.GetThemeCaretBrush();
    private static IBrush GetSearchHighlightBrush() => RichTextThemeBrushes.GetSearchHighlightBrush();
    private static IBrush GetActiveSearchHighlightBrush() => RichTextThemeBrushes.GetActiveSearchHighlightBrush();
    private static IBrush GetInlineHighlightBrush() => RichTextThemeBrushes.GetInlineHighlightBrush();
    private static IBrush? ResolveInlineBackgroundBrush(TextStyle style) => RichTextThemeBrushes.ResolveInlineBackgroundBrush(style);
    private static string TNotes(string key) => RichTextThemeBrushes.TNotes(key);
    private static IBrush GetEquationActiveHighlightBrush() => RichTextThemeBrushes.GetEquationActiveHighlightBrush();


}