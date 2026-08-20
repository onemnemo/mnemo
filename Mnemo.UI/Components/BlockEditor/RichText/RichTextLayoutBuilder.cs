using System;
using System.Collections.Generic;
using System.Text;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.TextFormatting;
using Avalonia.Utilities;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.TextShortcuts;

namespace Mnemo.UI.Components.BlockEditor;

/// <summary>
/// Pure layout-construction helpers for <see cref="RichTextEditor"/>:
/// expanded-layout-text building and text measurement.
/// Receives all required data as parameters; no reference to the control instance.
/// </summary>
internal static class RichTextLayoutBuilder
{
    private static readonly FontFamily MonoFont =
        new("Cascadia Code, Consolas, Courier New, monospace");

    private const double SubSuperscriptFontSizeRatio = 0.75;

    /// <summary>
    /// Builds the expanded layout text and run-property spans for both foreground and background
    /// <see cref="TextLayout"/> passes.  Equations are reserved with spaces; fractions are rendered
    /// as their symbolic shorthand via <see cref="FractionShortcutResolver"/>.
    /// </summary>
    /// <param name="docSpans">Source inline spans.</param>
    /// <param name="logicalLen">Total logical character count (atom spans count as 1).</param>
    /// <param name="defaultForeground">Fallback foreground brush.</param>
    /// <param name="defaultTypeface">Base typeface (may be overridden per-run for code/bold/italic).</param>
    /// <param name="fontSize">Base font size in device-independent pixels.</param>
    /// <param name="equationWidthResolver">
    ///   Callback that returns the reserved pixel width for an equation at the given logical index.
    ///   Return <c>placeholderAdvance</c> when the equation has no cached layout.
    /// </param>
    internal static (string LayoutText,
                     List<ValueSpan<TextRunProperties>> BackgroundSpans,
                     List<ValueSpan<TextRunProperties>> ForegroundSpans,
                     int[] Boundaries,
                     bool HasInlineBackground)
        BuildExpandedLayoutText(
            IReadOnlyList<InlineSpan> docSpans,
            int logicalLen,
            IBrush defaultForeground,
            Typeface defaultTypeface,
            double fontSize,
            Func<int, double, double> equationWidthResolver)
    {
        var sb = new StringBuilder();
        var backgroundSpans = new List<ValueSpan<TextRunProperties>>(docSpans.Count * 2);
        var foregroundSpans = new List<ValueSpan<TextRunProperties>>(docSpans.Count * 2);
        var boundaries = new int[logicalLen + 1];
        boundaries[0] = 0;
        int logicalIdx = 0;
        int layoutOffset = 0;
        bool hasBackground = false;

        foreach (var seg in docSpans)
        {
            if (seg is TextSpan run)
            {
                if (run.Text.Length == 0) continue;

                var style = run.Style;
                var ff = style.Code ? MonoFont : FontFamily.Default;
                var fw = style.Bold ? FontWeight.Bold : FontWeight.Normal;
                var fs = style.Italic ? FontStyle.Italic : FontStyle.Normal;
                var runTypeface = new Typeface(ff, fs, fw);

                TextDecorationCollection? decorations = null;
                if (style.Underline || style.Strikethrough || !string.IsNullOrEmpty(style.LinkUrl))
                {
                    decorations = new TextDecorationCollection();
                    if (style.Underline || !string.IsNullOrEmpty(style.LinkUrl))
                        decorations.Add(new TextDecoration { Location = TextDecorationLocation.Underline });
                    if (style.Strikethrough)
                        decorations.Add(new TextDecoration { Location = TextDecorationLocation.Strikethrough });
                }

                IBrush runForeground = RichTextThemeBrushes.ResolveRunForegroundBrush(style, defaultForeground);

                var background = RichTextThemeBrushes.ResolveInlineBackgroundBrush(style);
                if (background != null) hasBackground = true;

                double runFontSize = fontSize;
                var runBaseline = BaselineAlignment.Baseline;
                if (style.Subscript)
                {
                    runFontSize = fontSize * SubSuperscriptFontSizeRatio;
                    runBaseline = BaselineAlignment.Subscript;
                }
                else if (style.Superscript)
                {
                    runFontSize = fontSize * SubSuperscriptFontSizeRatio;
                    runBaseline = BaselineAlignment.Superscript;
                }

                var bgProps = new GenericTextRunProperties(
                    runTypeface, fontRenderingEmSize: runFontSize,
                    textDecorations: null, foregroundBrush: Brushes.Transparent,
                    backgroundBrush: background, baselineAlignment: runBaseline);

                var fgProps = new GenericTextRunProperties(
                    runTypeface, fontRenderingEmSize: runFontSize,
                    textDecorations: decorations, foregroundBrush: runForeground,
                    backgroundBrush: null, baselineAlignment: runBaseline);

                sb.Append(run.Text);
                backgroundSpans.Add(new ValueSpan<TextRunProperties>(layoutOffset, run.Text.Length, bgProps));
                foregroundSpans.Add(new ValueSpan<TextRunProperties>(layoutOffset, run.Text.Length, fgProps));
                for (var c = 0; c < run.Text.Length; c++)
                {
                    logicalIdx++;
                    layoutOffset++;
                    boundaries[logicalIdx] = layoutOffset;
                }
            }
            else if (seg is EquationSpan eq)
            {
                var style = eq.Style;
                var ff = style.Code ? MonoFont : FontFamily.Default;
                var fw = style.Bold ? FontWeight.Bold : FontWeight.Normal;
                var fs = style.Italic ? FontStyle.Italic : FontStyle.Normal;
                var runTypeface = new Typeface(ff, fs, fw);
                var background = RichTextThemeBrushes.ResolveInlineBackgroundBrush(style);
                if (background != null) hasBackground = true;

                var bgProps = new GenericTextRunProperties(
                    runTypeface, fontRenderingEmSize: fontSize,
                    textDecorations: null, foregroundBrush: Brushes.Transparent,
                    backgroundBrush: background);

                var fgProps = new GenericTextRunProperties(
                    runTypeface, fontRenderingEmSize: fontSize,
                    textDecorations: null, foregroundBrush: Brushes.Transparent,
                    backgroundBrush: null);

                var measureFg = NormalizeForegroundForMeasurement(defaultForeground);
                var placeholderAdv = MeasureTextWidth(InlineSpan.EquationAtomChar.ToString(), runTypeface, measureFg, fontSize);
                double target = equationWidthResolver(logicalIdx, placeholderAdv);
                int n = MinSpaceCountForWidth(target, runTypeface, measureFg, fontSize);
                for (var j = 0; j < n; j++)
                    sb.Append(' ');
                backgroundSpans.Add(new ValueSpan<TextRunProperties>(layoutOffset, n, bgProps));
                foregroundSpans.Add(new ValueSpan<TextRunProperties>(layoutOffset, n, fgProps));
                layoutOffset += n;
                logicalIdx++;
                boundaries[logicalIdx] = layoutOffset;
            }
            else if (seg is FractionSpan frac)
            {
                var style = frac.Style;
                var ff = style.Code ? MonoFont : FontFamily.Default;
                var fw = style.Bold ? FontWeight.Bold : FontWeight.Normal;
                var fs = style.Italic ? FontStyle.Italic : FontStyle.Normal;
                var runTypeface = new Typeface(ff, fs, fw);

                TextDecorationCollection? decorations = null;
                if (style.Underline || style.Strikethrough || !string.IsNullOrEmpty(style.LinkUrl))
                {
                    decorations = new TextDecorationCollection();
                    if (style.Underline || !string.IsNullOrEmpty(style.LinkUrl))
                        decorations.Add(new TextDecoration { Location = TextDecorationLocation.Underline });
                    if (style.Strikethrough)
                        decorations.Add(new TextDecoration { Location = TextDecorationLocation.Strikethrough });
                }

                IBrush runForeground = RichTextThemeBrushes.ResolveRunForegroundBrush(style, defaultForeground);

                var background = RichTextThemeBrushes.ResolveInlineBackgroundBrush(style);
                if (background != null) hasBackground = true;

                var bgProps = new GenericTextRunProperties(
                    runTypeface, fontRenderingEmSize: fontSize,
                    textDecorations: null, foregroundBrush: Brushes.Transparent,
                    backgroundBrush: background);

                var fgProps = new GenericTextRunProperties(
                    runTypeface, fontRenderingEmSize: fontSize,
                    textDecorations: decorations, foregroundBrush: runForeground,
                    backgroundBrush: null);

                var rendered = FractionShortcutResolver.Render(frac.Numerator, frac.Denominator);
                sb.Append(rendered);
                backgroundSpans.Add(new ValueSpan<TextRunProperties>(layoutOffset, rendered.Length, bgProps));
                foregroundSpans.Add(new ValueSpan<TextRunProperties>(layoutOffset, rendered.Length, fgProps));
                layoutOffset += rendered.Length;
                logicalIdx++;
                boundaries[logicalIdx] = layoutOffset;
            }
        }

        return (sb.ToString(), backgroundSpans, foregroundSpans, boundaries, hasBackground);
    }

    /// <summary>Measures the rendered width of a text string with the given typeface and font size.</summary>
    internal static double MeasureTextWidth(string text, Typeface typeface, IBrush fg, double fontSize)
    {
        if (text.Length == 0) return 0;
        using var tl = new TextLayout(
            text, typeface, fontSize, fg,
            TextAlignment.Left, TextWrapping.NoWrap, TextTrimming.None,
            null, FlowDirection.LeftToRight, 10000);
        return tl.Width > 0 ? tl.Width : fontSize * 0.25;
    }

    /// <summary>
    /// Transparent/zero-opacity brushes produce inaccurate width measurements.
    /// Substitute an opaque brush for measurement so space reservation is correct.
    /// </summary>
    internal static IBrush NormalizeForegroundForMeasurement(IBrush defaultForeground)
    {
        if (defaultForeground is null || defaultForeground.Opacity <= 0)
            return Brushes.Black;
        return defaultForeground;
    }

    /// <summary>Minimal number of spaces whose measured width ≥ <paramref name="targetWidth"/>.</summary>
    internal static int MinSpaceCountForWidth(double targetWidth, Typeface typeface, IBrush fg, double fontSize)
    {
        if (targetWidth <= 0)
            return 1;
        double spaceW = MeasureTextWidth(" ", typeface, fg, fontSize);
        if (spaceW <= 0)
            spaceW = fontSize * 0.25;
        spaceW = Math.Max(spaceW, fontSize * 0.22);
        int n = Math.Max(1, (int)Math.Ceiling(targetWidth / spaceW));
        while (n > 1)
        {
            double wPrev = MeasureTextWidth(new string(' ', n - 1), typeface, fg, fontSize);
            if (wPrev >= targetWidth)
                n--;
            else
                break;
        }
        return n;
    }

    /// <summary>Logical caret index to layout-text boundary index using a pre-computed boundary map.</summary>
    internal static int LogicalCaretToLayoutBoundary(int[] boundaryMap, int logicalCaret)
    {
        if (boundaryMap == null || boundaryMap.Length == 0) return 0;
        logicalCaret = Math.Clamp(logicalCaret, 0, boundaryMap.Length - 1);
        return boundaryMap[logicalCaret];
    }

    /// <summary>Layout-text boundary index back to logical caret index using a pre-computed boundary map.</summary>
    internal static int LayoutBoundaryIndexToLogicalCaret(int[] boundaryMap, int layoutBoundaryIndex)
    {
        if (boundaryMap == null || boundaryMap.Length == 0) return 0;
        int maxLogical = boundaryMap.Length - 1;
        int maxBound = boundaryMap[maxLogical];
        layoutBoundaryIndex = Math.Clamp(layoutBoundaryIndex, 0, maxBound);

        int u = 0;
        while (u <= maxLogical && boundaryMap[u] <= layoutBoundaryIndex)
            u++;
        if (u > maxLogical) return maxLogical;

        int loCaret = u - 1;
        if (layoutBoundaryIndex == boundaryMap[loCaret]) return loCaret;

        int hiBound = boundaryMap[u];
        if (layoutBoundaryIndex >= hiBound) return u;

        int loBound = boundaryMap[loCaret];
        if (hiBound <= loBound) return loCaret;

        int mid = (loBound + hiBound) / 2;
        return layoutBoundaryIndex < mid ? loCaret : loCaret + 1;
    }
}
