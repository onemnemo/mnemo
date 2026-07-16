using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;
using Mnemo.Core.Models.Markdown;
using Mnemo.Core.Services;
using Mnemo.UI.Controls;
using Mnemo.UI.Services.LaTeX.Layout.Boxes;

namespace Mnemo.UI.Services;

public class MarkdownRenderer : IMarkdownRenderer
{
    private readonly ILaTeXEngine _latexEngine;
    private readonly ISettingsService _settingsService;
    private readonly ITextMateSyntaxHighlighter _syntaxHighlighter;
    private readonly IPerfDiagnostics _perf;
    private readonly ILocalizationService _localization;
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .Build();

    // Cached settings (per renderer instance). Each render previously did 6 async settings reads per block;
    // a 50-block document hit ISettingsService.GetAsync ~300 times. Snapshot once, invalidate on SettingChanged.
    private double? _blockSpacing;
    private double? _baseFontSize;
    private double? _codeFontSize;
    private double? _mathFontSize;
    private double? _lineHeight;
    private double? _letterSpacing;

    public MarkdownRenderer(
        ILaTeXEngine latexEngine,
        ISettingsService settingsService,
        ITextMateSyntaxHighlighter syntaxHighlighter,
        IPerfDiagnostics perf,
        ILocalizationService localization)
    {
        _latexEngine = latexEngine;
        _settingsService = settingsService;
        _syntaxHighlighter = syntaxHighlighter;
        _perf = perf;
        _localization = localization;
        _settingsService.SettingChanged += OnSettingChanged;
    }

    private void OnSettingChanged(object? sender, string key)
    {
        if (!key.StartsWith("Markdown.", StringComparison.Ordinal)) return;
        switch (key)
        {
            case "Markdown.BlockSpacing": _blockSpacing = null; break;
            case "Markdown.FontSize": _baseFontSize = null; break;
            case "Markdown.CodeFontSize": _codeFontSize = null; break;
            case "Markdown.MathFontSize": _mathFontSize = null; break;
            case "Markdown.LineHeight": _lineHeight = null; break;
            case "Markdown.LetterSpacing": _letterSpacing = null; break;
        }
    }

    /// <summary>
    /// Per-render typography snapshot. A caller-supplied base font size (e.g. chat's compact scale)
    /// replaces the user's Markdown.* size settings for that render only; leading and spacing settings
    /// still apply.
    /// </summary>
    private sealed record RenderOptions(
        double BlockSpacing,
        double BaseFontSize,
        double CodeFontSize,
        double MathFontSize,
        double LineHeight,
        double LetterSpacing,
        MarkdownRenderProfile Profile)
    {
        public double LineHeightPx => BaseFontSize * LineHeight;
        public double DisplayMathFontSize => MathFontSize + 2;
    }

    private static FontFamily GetFontFamily(string resourceKey) =>
        (FontFamily)Application.Current!.FindResource(resourceKey)!;

    public async Task<Control> RenderAsync(
        string markdown,
        Dictionary<string, MarkdownSpecialInline> specialInlines,
        IBrush? foreground = null,
        double? baseFontSizeOverride = null,
        double? lineHeightOverride = null,
        MarkdownRenderProfile profile = MarkdownRenderProfile.Document)
    {
        using var scope = _perf.Measure("Render", "MarkdownRenderer.RenderAsync", $"{markdown.Length} chars");
        var document = Markdig.Markdown.Parse(markdown, Pipeline);
        var baseFontSize = baseFontSizeOverride ?? await GetBaseFontSizeAsync();
        // Conversational code steps down from prose (16 -> 14) so snippets read as part of the
        // answer; documents keep the user's explicit code-size setting.
        var codeFontSize = profile == MarkdownRenderProfile.Conversation
            ? Math.Round(baseFontSize * 0.875)
            : baseFontSizeOverride ?? await GetCodeFontSizeAsync();
        var options = new RenderOptions(
            await GetBlockSpacingAsync(),
            baseFontSize,
            codeFontSize,
            baseFontSizeOverride ?? await GetMathFontSizeAsync(),
            lineHeightOverride ?? await GetLineHeightAsync(),
            await GetLetterSpacingAsync(),
            profile);
        var container = new StackPanel { Spacing = options.BlockSpacing };

        foreach (var block in document)
        {
            var rendered = await RenderBlockAsync(block, specialInlines, foreground, options);
            if (rendered != null)
                container.Children.Add(rendered);
        }

        _perf.RecordMetric("Render", "MarkdownRenderer.blocks", document.Count, detail: $"{container.Children.Count} controls");
        return container;
    }

    private async Task<double> GetBlockSpacingAsync()
    {
        if (_blockSpacing is { } cached) return cached;
        var val = await _settingsService.GetAsync("Markdown.BlockSpacing", "Normal");
        var result = val switch
        {
            "Compact" => 6.0,
            "Relaxed" => 20.0,
            _ => 12.0
        };
        _blockSpacing = result;
        return result;
    }

    private async Task<double> GetBaseFontSizeAsync()
    {
        if (_baseFontSize is { } cached) return cached;
        var val = await _settingsService.GetAsync("Markdown.FontSize", "16px");
        var result = double.TryParse(val.Replace("px", ""), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : 16.0;
        _baseFontSize = result;
        return result;
    }

    private async Task<double> GetCodeFontSizeAsync()
    {
        if (_codeFontSize is { } cached) return cached;
        var val = await _settingsService.GetAsync("Markdown.CodeFontSize", "16px");
        var result = double.TryParse(val.Replace("px", ""), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : 16.0;
        _codeFontSize = result;
        return result;
    }

    private async Task<double> GetMathFontSizeAsync()
    {
        if (_mathFontSize is { } cached) return cached;
        var val = await _settingsService.GetAsync("Markdown.MathFontSize", "16px");
        var result = double.TryParse(val.Replace("px", ""), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : 16.0;
        _mathFontSize = result;
        return result;
    }

    private async Task<double> GetLineHeightAsync()
    {
        if (_lineHeight is { } cached) return cached;
        // Fallback must match the Settings UI default for Markdown.LineHeight; a lower value here
        // silently tightens all rendered prose for users who never touched the setting.
        var val = await _settingsService.GetAsync("Markdown.LineHeight", "1.5");
        var result = double.TryParse(val, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : 1.5;
        _lineHeight = result;
        return result;
    }

    private async Task<double> GetLetterSpacingAsync()
    {
        if (_letterSpacing is { } cached) return cached;
        var val = await _settingsService.GetAsync("Markdown.LetterSpacing", "0");
        var result = double.TryParse(val, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : 0.0;
        _letterSpacing = result;
        return result;
    }

    private async Task<Control?> RenderBlockAsync(Markdig.Syntax.Block block, Dictionary<string, MarkdownSpecialInline> specialInlines, IBrush? foreground, RenderOptions options, int listDepth = 0)
    {
        return block switch
        {
            ParagraphBlock paragraph => await RenderParagraphAsync(paragraph, specialInlines, foreground, options),
            HeadingBlock heading => await RenderHeadingAsync(heading, specialInlines, foreground, options),
            CodeBlock code => await RenderCodeBlockAsync(code, options),
            QuoteBlock quote => await RenderQuoteAsync(quote, specialInlines, foreground, options),
            ListBlock list => await RenderListAsync(list, specialInlines, foreground, options, listDepth),
            var table when table.GetType().Name == "Table" => await RenderTableAsync(table, specialInlines, foreground, options),
            ThematicBreakBlock => new Border
            {
                Height = 1,
                Margin = new Thickness(0, 8),
                Background = (SolidColorBrush)Application.Current!.FindResource("RichTextSeparationLineBrush")!
            },
            _ => null
        };
    }

    private async Task<Control> RenderParagraphAsync(ParagraphBlock paragraph, Dictionary<string, MarkdownSpecialInline> specialInlines, IBrush? foreground, RenderOptions options)
    {
        // Check whether this paragraph contains any display math.
        // If it does, we render the paragraph as a StackPanel with text segments
        // separated by standalone (block-level) display math controls, instead of
        // forcing large formulas into InlineUIContainer which garbles layout.
        if (ParagraphContainsDisplayMath(paragraph, specialInlines))
        {
            return await RenderParagraphWithDisplayMathAsync(paragraph, specialInlines, foreground, options);
        }

        // Simple path: no display math — single TextBlock with inline content.
        // Inflate LineHeight to fit inline math so Avalonia allocates enough vertical space
        // in the line box (Avalonia caps line boxes at LineHeight, unlike WPF).
        var effectiveLineHeightPx = await GetEffectiveLineHeightAsync(paragraph, specialInlines, options.LineHeightPx, options);
        var textBlock = CreateParagraphTextBlock(options.BaseFontSize, options.LineHeight, options.LetterSpacing, foreground);
        textBlock.LineHeight = effectiveLineHeightPx;

        if (paragraph.Inline != null && textBlock.Inlines != null)
        {
            foreach (var inline in paragraph.Inline)
            {
                await RenderInlineToInlinesAsync(inline, textBlock.Inlines, specialInlines, foreground, options, contextFontSize: options.BaseFontSize, contextLineHeightPx: effectiveLineHeightPx);
            }
        }

        return textBlock;
    }

    /// <summary>Returns true if any literal inline in this paragraph references a display-math placeholder.</summary>
    private static bool ParagraphContainsDisplayMath(ParagraphBlock paragraph, Dictionary<string, MarkdownSpecialInline> specialInlines)
    {
        if (paragraph.Inline == null) return false;

        foreach (var inline in paragraph.Inline)
        {
            if (inline is not LiteralInline literal) continue;
            var text = literal.Content.ToString();
            foreach (var kvp in specialInlines)
            {
                if (kvp.Value.Type == MarkdownInlineType.DisplayMath && text.Contains(kvp.Key))
                    return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Renders a paragraph that contains display math. The paragraph is split at each
    /// display-math placeholder: surrounding text is rendered in TextBlocks, and each
    /// display-math formula is rendered as a standalone centred LaTeX control.
    /// </summary>
    private async Task<Control> RenderParagraphWithDisplayMathAsync(
        ParagraphBlock paragraph,
        Dictionary<string, MarkdownSpecialInline> specialInlines,
        IBrush? foreground,
        RenderOptions options)
    {
        var container = new StackPanel { Spacing = 6 };
        var currentTextBlock = CreateParagraphTextBlock(options.BaseFontSize, options.LineHeight, options.LetterSpacing, foreground);

        if (paragraph.Inline != null)
        {
            foreach (var inline in paragraph.Inline)
            {
                if (inline is LiteralInline literal)
                {
                    // Process the literal text, splitting at display-math placeholders
                    currentTextBlock = await ProcessLiteralWithDisplayMathAsync(
                        literal.Content.ToString(),
                        currentTextBlock,
                        container,
                        specialInlines,
                        foreground,
                        options);
                }
                else
                {
                    // Non-literal inlines go straight into the current TextBlock
                    if (currentTextBlock.Inlines != null)
                        await RenderInlineToInlinesAsync(inline, currentTextBlock.Inlines, specialInlines, foreground, options, contextFontSize: options.BaseFontSize, contextLineHeightPx: options.LineHeightPx);
                }
            }
        }

        // Flush remaining text
        if (currentTextBlock.Inlines?.Count > 0)
            container.Children.Add(currentTextBlock);

        if (container.Children.Count > 1)
            container.ClipToBounds = false;

        return container.Children.Count == 1 ? (Control)container.Children[0] : container;
    }

    /// <summary>
    /// Walks a literal text segment, emitting runs / inline-math into the current TextBlock
    /// and breaking out display-math formulas as standalone controls in the container.
    /// Returns the (possibly new) current TextBlock to continue appending into.
    /// </summary>
    private async Task<TextBlock> ProcessLiteralWithDisplayMathAsync(
        string text,
        TextBlock currentTextBlock,
        StackPanel container,
        Dictionary<string, MarkdownSpecialInline> specialInlines,
        IBrush? foreground,
        RenderOptions options)
    {
        if (string.IsNullOrEmpty(text))
            return currentTextBlock;

        var position = 0;

        while (position < text.Length)
        {
            // Find the next placeholder marker
            var markerIndex = text.IndexOf("Ⓢ", position, StringComparison.Ordinal);
            if (markerIndex < 0)
            {
                // No more markers — append remainder as inline text
                AppendRunIfNonEmpty(currentTextBlock, text.Substring(position), foreground);
                break;
            }

            var endMarkerIndex = text.IndexOf("Ⓢ", markerIndex + 1, StringComparison.Ordinal);
            if (endMarkerIndex < 0)
            {
                AppendRunIfNonEmpty(currentTextBlock, text.Substring(position), foreground);
                break;
            }

            var potentialKey = text.Substring(markerIndex, endMarkerIndex - markerIndex + 1);

            if (specialInlines.TryGetValue(potentialKey, out var inlineData))
            {
                // Emit any text before the marker into the current TextBlock
                if (markerIndex > position)
                    AppendRunIfNonEmpty(currentTextBlock, text.Substring(position, markerIndex - position), foreground);

                if (inlineData.Type == MarkdownInlineType.DisplayMath)
                {
                    // ---- Display math: render as a standalone block ----
                    // Flush the current TextBlock into the container
                    if (currentTextBlock.Inlines?.Count > 0)
                    {
                        container.Children.Add(currentTextBlock);
                        currentTextBlock = CreateParagraphTextBlock(options.BaseFontSize, options.LineHeight, options.LetterSpacing, foreground);
                    }

                    if (await _settingsService.GetAsync("Markdown.RenderMath", true) && !string.IsNullOrWhiteSpace(inlineData.Content))
                    {
                        if (await _latexEngine.BuildLayoutAsync(inlineData.Content.Trim(), options.DisplayMathFontSize) is Mnemo.UI.Controls.LaTeXRenderer displayMathControl)
                        {
                            ApplyInlineMathLayout(displayMathControl, foreground, isInline: false);
                            // Wrap in a centred border so it sits on its own line
                            var wrapper = new Border
                            {
                                Child = displayMathControl,
                                HorizontalAlignment = HorizontalAlignment.Center,
                                Margin = new Thickness(0, 4)
                            };
                            container.Children.Add(wrapper);
                        }
                    }
                    else
                    {
                        container.Children.Add(new TextBlock
                        {
                            Text = $"$${inlineData.Content}$$",
                            Foreground = foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!,
                            TextWrapping = TextWrapping.Wrap
                        });
                    }
                }
                else
                {
                    // Non-display-math special inline — render into the current TextBlock
                    if (currentTextBlock.Inlines != null)
                        await RenderSpecialInlineAsync(inlineData, currentTextBlock.Inlines, foreground, options);
                }

                position = endMarkerIndex + 1;
            }
            else
            {
                // Not a recognised placeholder — advance past the first marker
                position = markerIndex + 1;
            }
        }

        return currentTextBlock;
    }

    /// <summary>Renders a single non-display-math special inline into the given InlineCollection.</summary>
    private async Task RenderSpecialInlineAsync(MarkdownSpecialInline inlineData, InlineCollection inlines, IBrush? foreground, RenderOptions options, bool isHeading = false)
    {
        switch (inlineData.Type)
        {
            case MarkdownInlineType.InlineMath:
                if (await _settingsService.GetAsync("Markdown.RenderMath", true) && !string.IsNullOrWhiteSpace(inlineData.Content))
                {
                    if (await _latexEngine.BuildLayoutAsync(inlineData.Content.Trim(), options.MathFontSize) is Mnemo.UI.Controls.LaTeXRenderer inlineMathControl)
                    {
                        ApplyInlineMathLayout(inlineMathControl, foreground, isInline: true);
                        inlines.Add(new InlineUIContainer { Child = inlineMathControl, BaselineAlignment = BaselineAlignment.Center });
                    }
                }
                else
                {
                    inlines.Add(new Run { Text = $"${inlineData.Content}$", Foreground = (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!) });
                }
                break;

            case MarkdownInlineType.Highlight:
                inlines.Add(new Run
                {
                    Text = inlineData.Content,
                    Background = (IBrush)Application.Current!.FindResource("HighlightedTextBrush")!,
                    Foreground = (isHeading ? (IBrush)Application.Current!.FindResource("TextPrimaryBrush")! : (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!))
                });
                break;

            case MarkdownInlineType.Superscript:
                var superscriptTextBlock = new TextBlock
                {
                    Text = inlineData.Content,
                    FontSize = 10,
                    Foreground = (isHeading ? (IBrush)Application.Current!.FindResource("TextPrimaryBrush")! : (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!)),
                };
                inlines.Add(new InlineUIContainer { Child = superscriptTextBlock, BaselineAlignment = BaselineAlignment.Superscript });
                break;

            case MarkdownInlineType.Subscript:
                var subscriptTextBlock = new TextBlock
                {
                    Text = inlineData.Content,
                    FontSize = 10,
                    Foreground = (isHeading ? (IBrush)Application.Current!.FindResource("TextPrimaryBrush")! : (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!)),
                };
                inlines.Add(new InlineUIContainer { Child = subscriptTextBlock, BaselineAlignment = BaselineAlignment.Subscript });
                break;

            case MarkdownInlineType.Strikethrough:
                inlines.Add(new Run
                {
                    Text = inlineData.Content,
                    TextDecorations = TextDecorations.Strikethrough,
                    Foreground = (isHeading ? (IBrush)Application.Current!.FindResource("TextPrimaryBrush")! : (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!))
                });
                break;
        }
    }

    private static void AppendRunIfNonEmpty(TextBlock textBlock, string text, IBrush? foreground)
    {
        if (string.IsNullOrWhiteSpace(text) || textBlock.Inlines == null) return;
        textBlock.Inlines.Add(new Run
        {
            Text = text,
            Foreground = foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!
        });
    }

    private static TextBlock CreateParagraphTextBlock(double fontSize, double lineHeight, double letterSpacing, IBrush? foreground)
    {
        return new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            FontSize = fontSize,
            LineHeight = fontSize * lineHeight,
            LetterSpacing = letterSpacing,
            Foreground = foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!,
            ClipToBounds = false
        };
    }

    private async Task RenderInlineToInlinesAsync(Markdig.Syntax.Inlines.Inline inline, InlineCollection inlines, Dictionary<string, MarkdownSpecialInline> specialInlines, IBrush? foreground, RenderOptions options, bool isHeading = false, double? contextFontSize = null, double? contextLineHeightPx = null)
    {
        switch (inline)
        {
            case LiteralInline literal:
                var text = literal.Content.ToString();
                await ReplaceSpecialPlaceholdersAsync(text, inlines, specialInlines, foreground, options, isHeading);
                break;

            case EmphasisInline emphasis:
                var span = new Span();
                if (emphasis.DelimiterCount == 2)
                    // Geist ships as per-weight files; FontWeight.Bold on the regular cut would synthesize
                    // a faux bold. Conversation drops to Medium — models bold liberally, and a chat page
                    // full of semibold reads shouty rather than emphasized.
                    span.FontFamily = GetFontFamily(options.Profile == MarkdownRenderProfile.Conversation ? "Font.Medium" : "Font.SemiBold");
                else if (emphasis.DelimiterCount == 1)
                    span.FontStyle = FontStyle.Italic;

                foreach (var child in emphasis)
                {
                    await RenderInlineToInlinesAsync(child, span.Inlines, specialInlines, foreground, options, isHeading, contextFontSize, contextLineHeightPx);
                }
                inlines.Add(span);
                break;

            case CodeInline code:
                // Runs can't carry padding; thin spaces keep the tint from hugging the glyphs.
                inlines.Add(new Run
                {
                    Text = $" {code.Content} ",
                    FontFamily = GetFontFamily("Font.Monospace"),
                    Foreground = foreground ?? (IBrush)Application.Current!.FindResource("TextPrimaryBrush")!,
                    Background = (IBrush)Application.Current!.FindResource("TextControlBackgroundBrush")!
                });
                break;

            case LinkInline link:
                var linkButton = new HyperlinkButton
                {
                    Background = Brushes.Transparent,
                    BorderThickness = new Thickness(0),
                    Padding = new Thickness(0),
                    Margin = new Thickness(0),
                    MinHeight = 0,
                    MinWidth = 0,
                    Cursor = new Cursor(StandardCursorType.Hand),
                    VerticalAlignment = VerticalAlignment.Bottom,
                    VerticalContentAlignment = VerticalAlignment.Bottom
                };

                var linkFontSize = contextFontSize ?? options.BaseFontSize;
                // Match the surrounding paragraph's line box so linked text shares its baseline;
                // a shorter line height here makes hyperlinks sit visibly lower than the sentence around them.
                var linkLineHeight = contextLineHeightPx ?? linkFontSize * options.LineHeight;
                var linkContent = new TextBlock
                {
                    FontSize = linkFontSize,
                    LineHeight = linkLineHeight,
                    Foreground = (IBrush)Application.Current!.FindResource("LinksBrush")!,
                    TextDecorations = TextDecorations.Underline,
                    Background = Brushes.Transparent
                };

                if (link.FirstChild is LiteralInline linkLiteral)
                {
                    linkContent.Text = linkLiteral.Content.ToString();
                }
                else
                {
                    foreach (var child in link)
                    {
                        if (linkContent.Inlines != null)
                        {
                            await RenderInlineToInlinesAsync(child, linkContent.Inlines, specialInlines, foreground, options, isHeading, contextFontSize, contextLineHeightPx);
                        }
                    }
                }

                linkButton.Content = linkContent;
                linkButton.Click += (sender, e) =>
                {
                    HandleLinkClick(link.Url);
                    e.Handled = true;
                };

                inlines.Add(new InlineUIContainer
                {
                    Child = linkButton,
                    BaselineAlignment = BaselineAlignment.Center
                });
                break;

            case LineBreakInline:
                inlines.Add(new LineBreak());
                break;

            case ContainerInline container:
                foreach (var child in container)
                {
                    await RenderInlineToInlinesAsync(child, inlines, specialInlines, foreground, options, isHeading, contextFontSize, contextLineHeightPx);
                }
                break;
        }
    }

    /// <summary>
    /// Applies layout so LaTeXRenderer works correctly inside InlineUIContainer: explicit size
    /// ensures the text layout reserves the right space and avoids overlap/garbled layout.
    /// Forces a layout pass to ensure proper measurement before embedding in inline context.
    /// </summary>
    private static void ApplyInlineMathLayout(Mnemo.UI.Controls.LaTeXRenderer control, IBrush? foreground, bool isInline)
    {
        control.HorizontalAlignment = HorizontalAlignment.Left;
        control.VerticalAlignment = VerticalAlignment.Bottom;
        
        // Enable inline mode for proper baseline alignment
        control.IsInlineMode = isInline;

        // In inline mode, depth (subscripts etc.) renders below the control bounds.
        // Ensure the control doesn't clip that overflow.
        if (isInline)
            control.ClipToBounds = false;
        
        if (foreground != null)
            control.SetValue(Mnemo.UI.Controls.LaTeXRenderer.ForegroundProperty, foreground);
        
        // Force a measure pass with infinite available size to get the natural size
        control.Measure(Size.Infinity);
        var size = control.DesiredSize;
        
        // Set explicit dimensions for InlineUIContainer layout
        control.Width = size.Width;
        control.Height = size.Height;
    }

    private async Task ReplaceSpecialPlaceholdersAsync(string text, InlineCollection inlines, Dictionary<string, MarkdownSpecialInline> specialInlines, IBrush? foreground, RenderOptions options, bool isHeading = false)
    {
        if (string.IsNullOrEmpty(text) || specialInlines.Count == 0)
        {
            if (!string.IsNullOrWhiteSpace(text))
                inlines.Add(new Run { Text = text, Foreground = (isHeading ? (IBrush)Application.Current!.FindResource("TextPrimaryBrush")! : (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!)) });
            return;
        }

        var position = 0;
        var textLength = text.Length;
        
        while (position < textLength)
        {
            var markerIndex = text.IndexOf("Ⓢ", position, StringComparison.Ordinal);
            if (markerIndex < 0)
            {
                var remainingText = text.Substring(position);
                if (!string.IsNullOrWhiteSpace(remainingText))
                    inlines.Add(new Run { Text = remainingText, Foreground = (isHeading ? (IBrush)Application.Current!.FindResource("TextPrimaryBrush")! : (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!)) });
                break;
            }

            var endMarkerIndex = text.IndexOf("Ⓢ", markerIndex + 1, StringComparison.Ordinal);
            if (endMarkerIndex < 0)
            {
                var remainingText = text.Substring(position);
                if (!string.IsNullOrWhiteSpace(remainingText))
                    inlines.Add(new Run { Text = remainingText, Foreground = (isHeading ? (IBrush)Application.Current!.FindResource("TextPrimaryBrush")! : (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!)) });
                break;
            }

            var potentialKey = text.Substring(markerIndex, endMarkerIndex - markerIndex + 1);
            
            if (specialInlines.TryGetValue(potentialKey, out var inlineData))
            {
                if (markerIndex > position)
                {
                    var beforeText = text.Substring(position, markerIndex - position);
                    if (!string.IsNullOrWhiteSpace(beforeText))
                        inlines.Add(new Run { Text = beforeText, Foreground = (isHeading ? (IBrush)Application.Current!.FindResource("TextPrimaryBrush")! : (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!)) });
                }

                if (inlineData.Type == MarkdownInlineType.DisplayMath)
                {
                    // Display math in non-display-math paragraphs (e.g. headings, quotes).
                    // Fall back to inline rendering since we can't split the block here.
                    if (await _settingsService.GetAsync("Markdown.RenderMath", true) && !string.IsNullOrWhiteSpace(inlineData.Content))
                    {
                        if (await _latexEngine.BuildLayoutAsync(inlineData.Content.Trim(), options.DisplayMathFontSize) is Mnemo.UI.Controls.LaTeXRenderer displayMathControl)
                        {
                            ApplyInlineMathLayout(displayMathControl, foreground, isInline: false);
                            inlines.Add(new InlineUIContainer { Child = displayMathControl, BaselineAlignment = BaselineAlignment.Center });
                        }
                    }
                    else
                    {
                        inlines.Add(new Run { Text = $"$${inlineData.Content}$$", Foreground = (foreground ?? (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!) });
                    }
                }
                else
                {
                    // All other special inlines (inline math, highlight, sub/superscript, strikethrough)
                    await RenderSpecialInlineAsync(inlineData, inlines, foreground, options, isHeading);
                }

                position = endMarkerIndex + 1;
            }
            else
            {
                position = markerIndex + 1;
            }
        }
    }

    private async Task<Control> RenderHeadingAsync(HeadingBlock heading, Dictionary<string, MarkdownSpecialInline> specialInlines, IBrush? foreground, RenderOptions options)
    {
        // Two ramps, both scaled from the base size. Documents keep the classic reading scale
        // (32/24/20/18/16/14 at 16px). Conversation caps headings just above body size so an
        // answer keeps a spoken rhythm — hierarchy comes from weight and space, not poster type.
        var scale = options.Profile == MarkdownRenderProfile.Conversation
            ? heading.Level switch
            {
                1 => 1.375,
                2 => 1.25,
                3 => 1.125,
                4 => 1.0,
                5 => 1.0,
                _ => 0.875
            }
            : heading.Level switch
            {
                1 => 2.0,
                2 => 1.5,
                3 => 1.25,
                4 => 1.125,
                5 => 1.0,
                _ => 0.875
            };
        var fontSize = Math.Round(options.BaseFontSize * scale);
        // Headings read best with tighter leading than body copy; cap the user's prose setting.
        var headingLineHeightPx = fontSize * Math.Min(options.LineHeight, 1.3);
        // Space belongs above a heading, where it separates sections; below it stays close
        // to the content it introduces. Conversation halves the document's air.
        var headingMargin = options.Profile == MarkdownRenderProfile.Conversation
            ? new Thickness(0, heading.Level == 1 ? 8 : 6, 0, 0)
            : new Thickness(0, heading.Level == 1 ? 16 : 12, 0, 8);

        var textBlock = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            FontFamily = GetFontFamily("Font.SemiBold"),
            FontSize = fontSize,
            LineHeight = headingLineHeightPx,
            LetterSpacing = options.LetterSpacing,
            Margin = headingMargin,
            Foreground = (IBrush)Application.Current!.FindResource("TextPrimaryBrush")!
        };

        if (heading.Inline != null && textBlock.Inlines != null)
        {
            foreach (var inline in heading.Inline)
            {
                await RenderInlineToInlinesAsync(inline, textBlock.Inlines, specialInlines, foreground, options, isHeading: true, contextFontSize: fontSize, contextLineHeightPx: headingLineHeightPx);
            }
        }

        return textBlock;
    }

    private Task<Control> RenderCodeBlockAsync(CodeBlock codeBlock, RenderOptions options)
    {
        var fenced = codeBlock as FencedCodeBlock;
        var language = (fenced?.Info ?? string.Empty).Trim();
        var code = fenced?.Lines.ToString() ?? ((LeafBlock)codeBlock).Lines.ToString();
        var codeFontSize = options.CodeFontSize;
        var app = Application.Current!;
        var defaultFg = (app.TryGetResource("SyntaxCodeDefaultBrush", app.ActualThemeVariant, out var synFg) && synFg is IBrush sb)
            ? sb
            : (IBrush)app.FindResource("TextPrimaryBrush")!;

        // One flat well: a single tinted surface with a hairline edge. No header bar, no
        // line-number gutter — the code is the content, everything else stays out of its way.
        var container = new Border
        {
            Background = (IBrush)app.FindResource("TextControlBackgroundBrush")!,
            BorderBrush = (IBrush)app.FindResource("RichTextSeparationLineBrush")!,
            BorderThickness = new Thickness(1),
            CornerRadius = (CornerRadius)app.FindResource("Radius.Lg")!,
            ClipToBounds = true,
            Margin = new Thickness(0, 8)
        };

        var header = new Grid { Margin = new Thickness(14, 6, 6, 0) };
        header.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));
        header.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
        header.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));

        var languageLabel = new TextBlock
        {
            Text = SketchSyntaxHighlighter.GetDisplayLanguageLabel(language),
            FontFamily = GetFontFamily("Font.Monospace"),
            FontSize = (double)app.FindResource("FontSize.Body.Caption")!,
            Foreground = (IBrush)app.FindResource("TextFadedBrush")!,
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(languageLabel, 0);

        var copyButton = new AppButton
        {
            Classes = { "ghost" },
            IconName = "Common/copy",
            IconSize = 13,
            Padding = new Thickness(6),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center
        };
        ToolTip.SetTip(copyButton, _localization.T("Copy", "Common"));
        Grid.SetColumn(copyButton, 2);
        DispatcherTimer? revertTimer = null;
        copyButton.Click += async (_, _) =>
        {
            try
            {
                var topLevel = TopLevel.GetTopLevel(copyButton);
                if (topLevel?.Clipboard != null)
                    await topLevel.Clipboard.SetTextAsync(code);
            }
            catch
            {
                // Clipboard access might fail
            }
            // Brief confirmation, then back to the copy glyph.
            copyButton.IconName = "States/done-check";
            revertTimer?.Stop();
            revertTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
            revertTimer.Tick += (_, _) =>
            {
                revertTimer.Stop();
                copyButton.IconName = "Common/copy";
            };
            revertTimer.Start();
        };

        header.Children.Add(languageLabel);
        header.Children.Add(copyButton);

        var codeFont = GetFontFamily("Font.Monospace");
        var lineHeight = codeFontSize * (20.0 / 13.0);
        var codeTextBlock = new TextBlock
        {
            FontFamily = codeFont,
            FontSize = codeFontSize,
            LineHeight = lineHeight,
            TextWrapping = TextWrapping.NoWrap,
            Foreground = defaultFg,
            Padding = new Thickness(14, 4, 14, 12)
        };

        _syntaxHighlighter.ApplyToTextBlock(codeTextBlock, code, string.IsNullOrEmpty(language) ? null : language, defaultFg);

        var codeScroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            Content = codeTextBlock
        };

        var outerScroll = new ScrollViewer
        {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            MaxHeight = 420,
            Content = codeScroll
        };

        var stackPanel = new StackPanel();
        stackPanel.Children.Add(header);
        stackPanel.Children.Add(outerScroll);
        container.Child = stackPanel;
        return Task.FromResult<Control>(container);
    }

    private async Task<Control> RenderQuoteAsync(QuoteBlock quote, Dictionary<string, MarkdownSpecialInline> specialInlines, IBrush? foreground, RenderOptions options)
    {
        // A 2px bar and breathing room; the quote stays prose, not a callout box.
        var border = new Border
        {
            BorderBrush = (IBrush)Application.Current!.FindResource("RichTextSeparationLineBrush")!,
            BorderThickness = new Thickness(2, 0, 0, 0),
            Padding = new Thickness(14, 2, 0, 2),
            Margin = new Thickness(0, 4)
        };

        var container = new StackPanel { Spacing = 8 };

        foreach (var block in quote)
        {
            var rendered = await RenderBlockAsync(block, specialInlines, foreground, options);
            if (rendered != null)
                container.Children.Add(rendered);
        }

        border.Child = container;
        return border;
    }

    private string GetBulletSymbol(int depth, bool isOrdered, int index)
    {
        if (isOrdered)
        {
            return $"{index}.";
        }

        return depth switch
        {
            0 => "•",  // Filled circle
            1 => "○",  // Circle
            2 => "▪",  // Square
            3 => "▫",  // White square
            _ => "•"   // Cycle back to filled circle for deeper nesting
        };
    }

    /// <summary>
    /// Returns the effective line height for a paragraph: the normal line height, or the tallest
    /// inline-math box height if the paragraph contains inline LaTeX. Avalonia caps line boxes at
    /// the TextBlock.LineHeight value, so we must inflate it to prevent math from overflowing.
    /// </summary>
    private async Task<double> GetEffectiveLineHeightAsync(ParagraphBlock paragraph, Dictionary<string, MarkdownSpecialInline> specialInlines, double lineHeightPx, RenderOptions options)
    {
        if (paragraph.Inline == null || specialInlines.Count == 0)
            return lineHeightPx;

        var inlineFontSize = options.MathFontSize;
        const double inlinePad = 2;
        var maxLaTeXHeight = 0.0;

        foreach (var kvp in specialInlines)
        {
            if (kvp.Value.Type != MarkdownInlineType.InlineMath || string.IsNullOrWhiteSpace(kvp.Value.Content))
                continue;
            if (!ParagraphContainsPlaceholder(paragraph, kvp.Key))
                continue;

            var boxObj = await _latexEngine.GetLayoutBoxAsync(kvp.Value.Content.Trim(), inlineFontSize);
            if (boxObj is Box box)
                maxLaTeXHeight = Math.Max(maxLaTeXHeight, box.TotalHeight + inlinePad);
        }

        return maxLaTeXHeight > 0 ? Math.Max(lineHeightPx, maxLaTeXHeight) : lineHeightPx;
    }

    private static bool ParagraphContainsPlaceholder(ParagraphBlock paragraph, string placeholder)
    {
        if (paragraph.Inline == null) return false;
        foreach (var inline in paragraph.Inline)
        {
            if (inline is LiteralInline literal && literal.Content.ToString().Contains(placeholder, StringComparison.Ordinal))
                return true;
        }
        return false;
    }

    private async Task<Control> RenderListAsync(ListBlock list, Dictionary<string, MarkdownSpecialInline> specialInlines, IBrush? foreground, RenderOptions options, int depth = 0)
    {
        // Items sit closer than paragraphs — a list is one thought, not a run of sections.
        var container = new StackPanel { Spacing = Math.Max(4, options.BlockSpacing / 2), Margin = new Thickness(0, 0) };
        var fontSize = options.BaseFontSize;
        var letterSpacing = options.LetterSpacing;
        var lineHeightPx = options.LineHeightPx;
        var bulletLineHeight = lineHeightPx;
        int index = 1;

        foreach (var item in list.Cast<ListItemBlock>())
        {
            var firstBlock = item.Cast<Markdig.Syntax.Block>().FirstOrDefault();
            var firstLineHeight = firstBlock is ParagraphBlock firstParagraph
                ? await GetEffectiveLineHeightAsync(firstParagraph, specialInlines, lineHeightPx, options)
                : lineHeightPx;

            // When the first line is tall (inline math), offset the bullet so it aligns
            // with the text baseline rather than sitting at the very top of the row.
            var bulletTopOffset = Math.Max(0, firstLineHeight * 0.6 - bulletLineHeight * 0.5);

            var itemContainer = new Grid
            {
                ColumnDefinitions = new ColumnDefinitions("Auto,*"),
                ClipToBounds = false,
                VerticalAlignment = VerticalAlignment.Top
            };

            // Markers are wayfinding, not content: body-size glyphs in the secondary ink,
            // never louder than the text they introduce.
            var bulletSize = depth == 0 ? fontSize : fontSize * 0.75;
            var bullet = new TextBlock
            {
                Text = GetBulletSymbol(depth, list.IsOrdered, index),
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, bulletTopOffset, list.IsOrdered ? 8 : 10, 0),
                FontSize = bulletSize,
                LineHeight = lineHeightPx,
                LetterSpacing = letterSpacing,
                Foreground = (IBrush)Application.Current!.FindResource("TextSecondaryBrush")!
            };
            Grid.SetColumn(bullet, 0);

            var content = new StackPanel
            {
                Spacing = 4,
                ClipToBounds = false,
                VerticalAlignment = VerticalAlignment.Top
            };
            foreach (var block in item)
            {
                var blockDepth = block is ListBlock ? depth + 1 : depth;
                var rendered = await RenderBlockAsync(block, specialInlines, foreground, options, blockDepth);
                if (rendered != null)
                    content.Children.Add(rendered);
            }

            Grid.SetColumn(content, 1);

            itemContainer.Children.Add(bullet);
            itemContainer.Children.Add(content);
            container.Children.Add(itemContainer);

            if (list.IsOrdered)
                index++;
        }

        return container;
    }

    private async Task<Control> RenderTableAsync(Markdig.Syntax.Block table, Dictionary<string, MarkdownSpecialInline> specialInlines, IBrush? foreground, RenderOptions options)
    {
        if (table is not Markdig.Extensions.Tables.Table markdigTable)
        {
            return new TextBlock { Text = "Invalid table format" };
        }
        
        // Horizontal dividers only: no outer box, no zebra fills, no vertical rules.
        // The first column sits flush with the surrounding prose.
        var grid = new Grid
        {
            HorizontalAlignment = HorizontalAlignment.Left
        };

        var scrollViewer = new ScrollViewer
        {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            Margin = new Thickness(0, 8),
            HorizontalAlignment = HorizontalAlignment.Left
        };

        var divider = (IBrush)Application.Current!.FindResource("RichTextSeparationLineBrush")!;

        for (int i = 0; i < markdigTable.ColumnDefinitions.Count; i++)
        {
            var columnDef = new ColumnDefinition();
            columnDef.Width = GridLength.Auto;
            grid.ColumnDefinitions.Add(columnDef);
        }

        int lastRowIndex = markdigTable.Count - 1;
        for (int rowIndex = 0; rowIndex < markdigTable.Count; rowIndex++)
        {
            var row = markdigTable[rowIndex];
            if (row is not Markdig.Extensions.Tables.TableRow tableRow) continue;

            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            bool isHeaderRow = rowIndex == 0;
            bool isLastRow = rowIndex == lastRowIndex;

            for (int cellIndex = 0; cellIndex < tableRow.Count; cellIndex++)
            {
                var cell = tableRow[cellIndex];
                if (cell is not Markdig.Extensions.Tables.TableCell tableCell) continue;

                var cellBorder = new Border
                {
                    BorderBrush = divider,
                    BorderThickness = new Thickness(0, 0, 0, isLastRow ? 0 : 1),
                    Padding = new Thickness(cellIndex == 0 ? 0 : 16, 8, 16, 8)
                };

                var cellContent = new StackPanel { Spacing = 4 };

                foreach (var block in tableCell)
                {
                    var rendered = await RenderBlockAsync(block, specialInlines, foreground, options);
                    if (rendered != null)
                    {
                        if (isHeaderRow && rendered is TextBlock headerTextBlock)
                        {
                            headerTextBlock.FontFamily = GetFontFamily("Font.Medium");
                            headerTextBlock.Foreground = (IBrush)Application.Current!.FindResource("TextPrimaryBrush")!;
                        }
                        cellContent.Children.Add(rendered);
                    }
                }

                cellBorder.Child = cellContent;
                Grid.SetRow(cellBorder, rowIndex);
                Grid.SetColumn(cellBorder, cellIndex);
                grid.Children.Add(cellBorder);
            }
        }

        scrollViewer.Content = grid;
        return scrollViewer;
    }

    private void HandleLinkClick(string? url)
    {
        if (string.IsNullOrEmpty(url))
            return;

        try
        {
            if (url.StartsWith("#"))
            {
                return;
            }

            if (url.StartsWith("http://") || url.StartsWith("https://") || url.StartsWith("mailto:"))
            {
                var process = new System.Diagnostics.Process
                {
                    StartInfo = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = url,
                        UseShellExecute = true
                    }
                };
                process.Start();
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Failed to open link {url}: {ex.Message}");
        }
    }
}