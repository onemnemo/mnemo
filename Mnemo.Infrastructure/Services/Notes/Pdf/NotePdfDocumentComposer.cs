using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Core.Sketch;
using Mnemo.Infrastructure.Services.Notes.Markdown;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

internal static class NotePdfDocumentComposer
{
    /// <summary>Surrounding text size (pt) for the block; inline TeX is rasterized at this × <see cref="InlineEquationRasterBoost"/>.</summary>
    public static double InlineEquationRasterFontPt(BlockType blockType, NotePdfExportOptions options) =>
        blockType switch
        {
            BlockType.Heading1 => options.BaseFontSizePt + 10f,
            BlockType.Heading2 => options.BaseFontSizePt + 6f,
            BlockType.Heading3 => options.BaseFontSizePt + 3f,
            BlockType.Heading4 => options.BaseFontSizePt + 1.5f,
            _ => options.BaseFontSizePt
        };

    /// <summary>TeX raster is built slightly above text size so math matches apparent weight next to prose (LaTeX glyphs read smaller at equal point size).</summary>
    public const double InlineEquationRasterBoost = 1.22;

    /// <summary>Font passed to LaTeX layout / cache key for inline math; keep in sync between export prefetch and <see cref="ComposeRichText"/>.</summary>
    public static double InlineEquationRasterLayoutFont(BlockType blockType, NotePdfExportOptions options) =>
        InlineEquationRasterFontPt(blockType, options) * InlineEquationRasterBoost;

    public static IDocument CreateDocument(
        Note note,
        NotePdfExportOptions options,
        IReadOnlyDictionary<string, NotePdfLatexRaster>? latexImages = null)
    {
        var blocks = GetOrderedBlocksForExport(note);
        latexImages ??= new Dictionary<string, NotePdfLatexRaster>();

        return Document.Create(document =>
        {
            document.Page(page =>
            {
                page.Size(options.Paper == NotePdfPaperKind.Letter ? PageSizes.Letter : PageSizes.A4);
                var marginCm = options.Margin == NotePdfMarginPreset.Narrow ? 1.2f : 2f;
                page.Margin(marginCm, Unit.Centimetre);
                page.DefaultTextStyle(x => x.FontSize(options.BaseFontSizePt).FontColor(Colors.Black));

                ComposePageFooter(page, options);

                page.Content().Column(column =>
                {
                    column.Spacing(10);

                    if (options.IncludeNoteTitle && !string.IsNullOrWhiteSpace(note.Title))
                    {
                        column.Item().Text(note.Title.Trim()).SemiBold().FontSize(options.BaseFontSizePt + 8f);
                        column.Item().PaddingBottom(8).LineHorizontal(1).LineColor(Colors.Grey.Lighten2);
                    }

                    foreach (var block in blocks)
                        ComposeBlock(column, block, options, latexImages);
                });
            });
        });
    }

    private static void ComposePageFooter(PageDescriptor page, NotePdfExportOptions options)
    {
        if (options.PageNumberAlignment == NotePdfPageNumberAlignment.None)
            return;

        var footer = options.PageNumberAlignment switch
        {
            NotePdfPageNumberAlignment.Left => page.Footer().AlignLeft(),
            NotePdfPageNumberAlignment.Right => page.Footer().AlignRight(),
            _ => page.Footer().AlignCenter()
        };

        footer.Text(text =>
        {
            text.DefaultTextStyle(x => x.FontSize(options.BaseFontSizePt - 1f).FontColor(Colors.Grey.Medium));
            text.CurrentPageNumber();
            if (options.PageNumberFormat == NotePdfPageNumberFormat.CurrentAndTotalPages)
            {
                text.Span(" / ");
                text.TotalPages();
            }
        });
    }

    private static List<Block> GetOrderedBlocksForExport(Note note)
    {
        if (note.Blocks is { Count: > 0 })
        {
            var list = note.Blocks.OrderBy(b => b.Order).ThenBy(b => b.Id).ToList();
            foreach (var b in list)
                b.EnsureSpans();
            NoteDocumentHelper.NormalizeOrders(list);
            return list;
        }

        var raw = note.Content ?? string.Empty;
        if (string.IsNullOrEmpty(raw))
            return [];

        var parsed = NoteBlockMarkdownConverter.Deserialize(raw);
        if (parsed.Count > 0)
        {
            foreach (var b in parsed)
                b.EnsureSpans();
            NoteDocumentHelper.NormalizeOrders(parsed);
            return parsed;
        }

        return
        [
            new Block
            {
                Id = Guid.NewGuid().ToString(),
                Type = BlockType.Text,
                Spans = [InlineSpan.Plain(raw)],
                Order = 0
            }
        ];
    }

    private static void ComposeBlock(
        ColumnDescriptor column,
        Block block,
        NotePdfExportOptions options,
        IReadOnlyDictionary<string, NotePdfLatexRaster> latexImages)
    {
        switch (block.Type)
        {
            case BlockType.Page:
                return;
            case BlockType.ColumnGroup:
                if (block.Children is { Count: > 0 })
                {
                    foreach (var child in block.Children.OrderBy(c => c.Order).ThenBy(c => c.Id))
                        ComposeBlock(column, child, options, latexImages);
                }
                return;
            case BlockType.TwoColumn:
                ComposeTwoColumn(column, block, options, latexImages);
                return;
            default:
                ComposeLeafBlock(column, block, options, latexImages);
                return;
        }
    }

    private static void ComposeTwoColumn(
        ColumnDescriptor column,
        Block block,
        NotePdfExportOptions options,
        IReadOnlyDictionary<string, NotePdfLatexRaster> latexImages)
    {
        var ratio = 0.5f;
        if (block.Payload is TwoColumnPayload tcp)
            ratio = (float)Math.Clamp(tcp.SplitRatio, 0.1, 0.9);

        var leftWeight = ratio;
        var rightWeight = 1f - ratio;

        var children = block.Children;
        Block? leftGroup = children is { Count: > 0 } ? children[0] : null;
        Block? rightGroup = children is { Count: > 1 } ? children[1] : null;

        column.Item().Row(row =>
        {
            row.Spacing(12);
            row.RelativeItem(leftWeight).Column(leftCol =>
            {
                leftCol.Spacing(8);
                ComposeColumnGroupContent(leftCol, leftGroup, options, latexImages);
            });
            row.RelativeItem(rightWeight).Column(rightCol =>
            {
                rightCol.Spacing(8);
                ComposeColumnGroupContent(rightCol, rightGroup, options, latexImages);
            });
        });
    }

    private static void ComposeColumnGroupContent(
        ColumnDescriptor col,
        Block? group,
        NotePdfExportOptions options,
        IReadOnlyDictionary<string, NotePdfLatexRaster> latexImages)
    {
        if (group == null) return;
        if (group.Type == BlockType.ColumnGroup && group.Children is { Count: > 0 })
        {
            foreach (var child in group.Children.OrderBy(c => c.Order).ThenBy(c => c.Id))
                ComposeBlock(col, child, options, latexImages);
        }
        else
            ComposeBlock(col, group, options, latexImages);
    }

    private static void ComposeLeafBlock(
        ColumnDescriptor column,
        Block block,
        NotePdfExportOptions options,
        IReadOnlyDictionary<string, NotePdfLatexRaster> latexImages)
    {
        block.EnsureSpans();
        var body = FlattenDisplay(block.Spans);

        switch (block.Type)
        {
            case BlockType.Heading1:
                column.Item().Text(text => ComposeRichText(text, block.Spans, options, latexImages, options.BaseFontSizePt + 10f, forceBold: true));
                break;
            case BlockType.Heading2:
                column.Item().Text(text => ComposeRichText(text, block.Spans, options, latexImages, options.BaseFontSizePt + 6f, forceBold: true));
                break;
            case BlockType.Heading3:
                column.Item().Text(text => ComposeRichText(text, block.Spans, options, latexImages, options.BaseFontSizePt + 3f, forceBold: true));
                break;
            case BlockType.Heading4:
                column.Item().Text(text => ComposeRichText(text, block.Spans, options, latexImages, options.BaseFontSizePt + 1.5f, forceBold: true));
                break;
            case BlockType.BulletList:
                column.Item().Text(text =>
                {
                    text.Span("• ");
                    ComposeRichText(text, block.Spans, options, latexImages);
                });
                break;
            case BlockType.NumberedList:
                column.Item().Text(text =>
                {
                    text.Span($"{ReadListNumberIndex(block)}. ");
                    ComposeRichText(text, block.Spans, options, latexImages);
                });
                break;
            case BlockType.Checklist:
            {
                var mark = IsChecklistChecked(block) ? "[x]" : "[ ]";
                column.Item().Text(text =>
                {
                    text.Span($"{mark} ");
                    ComposeRichText(text, block.Spans, options, latexImages);
                });
                break;
            }
            case BlockType.Quote:
                column.Item()
                    .BorderLeft(3)
                    .BorderColor(Colors.Grey.Medium)
                    .PaddingLeft(10)
                    .Text(text => ComposeRichText(text, block.Spans, options, latexImages, forceItalic: true));
                break;
            case BlockType.Code:
            {
                var src = block.Payload is CodePayload cp
                    ? cp.Source
                    : body;
                column.Item()
                    .Background(Colors.Grey.Lighten3)
                    .Padding(10)
                    .Text(src)
                    .FontFamily("Consolas")
                    .FontSize(Math.Max(9f, options.BaseFontSizePt - 1f));
                break;
            }
            case BlockType.Sketch:
                if (options.RenderImages)
                    ComposeSketch(column, block, body, options);
                break;
            case BlockType.Divider:
                column.Item().LineHorizontal(1).LineColor(Colors.Grey.Lighten1);
                break;
            case BlockType.Equation:
            {
                var latex = block.Payload is EquationPayload ep ? ep.Latex : body;
                ComposeLatexBlock(column, latex, options, latexImages, displayFontSizePt: 16f);
                break;
            }
            case BlockType.Image:
                if (options.RenderImages)
                    ComposeImage(column, block, options, latexImages);
                break;
            case BlockType.Text:
            default:
                if (!string.IsNullOrWhiteSpace(body))
                    column.Item().Text(text => ComposeRichText(text, block.Spans, options, latexImages));
                break;
        }
    }

    private static void ComposeRichText(
        TextDescriptor text,
        IReadOnlyList<InlineSpan> spans,
        NotePdfExportOptions options,
        IReadOnlyDictionary<string, NotePdfLatexRaster> latexImages,
        float? fontSize = null,
        bool forceBold = false,
        bool forceItalic = false)
    {
        if (spans.Count == 0)
            return;

        foreach (var span in spans)
        {
            switch (span)
            {
                case Mnemo.Core.Models.TextSpan textSpan:
                    EmitStyledSpan(text, textSpan.Text, textSpan.Style, options, fontSize, forceBold, forceItalic);
                    break;
                case EquationSpan equationSpan:
                {
                    var eqFont = (fontSize ?? options.BaseFontSizePt) * (float)InlineEquationRasterBoost;
                    if (TryGetLatexImage(latexImages, equationSpan.Latex, eqFont, out var inlineRaster))
                    {
                        // Bottom of control = math baseline (same as Avalonia LaTeXRenderer inline mode). Middle() sinks the chip like a subscript.
                        text.Element(TextInjectedElementAlignment.AboveBaseline)
                            .Width(inlineRaster.WidthPt, Unit.Point)
                            .Image(inlineRaster.Png)
                            .FitWidth();
                    }
                    else
                    {
                        EmitStyledSpan(
                            text,
                            ConvertLatexToReadableMath(equationSpan.Latex),
                            equationSpan.Style with { Code = false },
                            options,
                            fontSize,
                            forceBold,
                            forceItalic,
                            mathFont: true);
                    }

                    break;
                }
                case FractionSpan fractionSpan:
                    EmitStyledSpan(text, fractionSpan.Numerator.ToString(), fractionSpan.Style, options, fontSize, forceBold, forceItalic);
                    EmitStyledSpan(text, "/", fractionSpan.Style, options, fontSize, forceBold, forceItalic);
                    EmitStyledSpan(text, fractionSpan.Denominator.ToString(), fractionSpan.Style, options, fontSize, forceBold, forceItalic);
                    break;
            }
        }
    }

    private static void EmitStyledSpan(
        TextDescriptor text,
        string content,
        Mnemo.Core.Models.TextStyle style,
        NotePdfExportOptions options,
        float? fontSize,
        bool forceBold,
        bool forceItalic,
        bool mathFont = false)
    {
        if (string.IsNullOrEmpty(content))
            return;

        var descriptor = text.Span(content);
        descriptor.FontSize(fontSize ?? options.BaseFontSizePt);

        if (style.Bold || forceBold)
            descriptor.Bold();
        if (style.Italic || forceItalic)
            descriptor.Italic();
        if (style.Underline || !string.IsNullOrWhiteSpace(style.LinkUrl))
            descriptor.Underline();
        if (style.Strikethrough)
            descriptor.Strikethrough();
        if (style.Subscript)
            descriptor.Subscript();
        if (style.Superscript)
            descriptor.Superscript();

        if (style.Code)
        {
            descriptor.FontFamily("Consolas", "Cascadia Mono", "Courier New");
            descriptor.BackgroundColor(Colors.Grey.Lighten3);
        }
        else if (mathFont)
            descriptor.FontFamily("Cambria Math", "STIX Two Math", "Latin Modern Math", "Times New Roman");

        if (options.RenderColors)
        {
            if (style.Highlight)
                descriptor.BackgroundColor(Colors.Yellow.Lighten3);
            if (TryResolveSpanColor(options.BackgroundSwatchHexByName, style.BackgroundColor, out var background))
                descriptor.BackgroundColor(background);
            if (TryResolveSpanColor(options.ForegroundSwatchHexByName, style.ForegroundColor, out var foreground))
            {
                descriptor.FontColor(foreground);
                return;
            }
        }

        if (!string.IsNullOrWhiteSpace(style.LinkUrl))
            descriptor.FontColor(Colors.Blue.Medium);
    }

    private static void ComposeLatexBlock(
        ColumnDescriptor column,
        string latex,
        NotePdfExportOptions options,
        IReadOnlyDictionary<string, NotePdfLatexRaster> latexImages,
        float displayFontSizePt)
    {
        var fontSize = displayFontSizePt;
        if (TryGetLatexImage(latexImages, latex, fontSize, out var blockRaster))
        {
            var w = Math.Min(blockRaster.WidthPt, 520f);
            column.Item()
                .AlignLeft()
                .Width(w, Unit.Point)
                .Image(blockRaster.Png)
                .FitWidth();
            return;
        }

        column.Item()
            .Background(Colors.Grey.Lighten4)
            .Padding(8)
            .Text(text =>
            {
                text.DefaultTextStyle(x => x.FontSize(fontSize));
                EmitStyledSpan(
                    text,
                    ConvertLatexToReadableMath(latex),
                    Mnemo.Core.Models.TextStyle.Default,
                    options,
                    fontSize,
                    forceBold: false,
                    forceItalic: false,
                    mathFont: true);
            });
    }

    internal static string GetLatexImageKey(string latex, double fontSize) =>
        $"{Math.Round(fontSize, 2):0.##}|{latex.Trim()}";

    private static bool TryGetLatexImage(
        IReadOnlyDictionary<string, NotePdfLatexRaster> latexImages,
        string latex,
        double fontSize,
        out NotePdfLatexRaster raster) =>
        latexImages.TryGetValue(GetLatexImageKey(latex, fontSize), out raster!);

    private static string FlattenDisplay(IReadOnlyList<InlineSpan> spans) =>
        string.Concat(spans.Select(static s => s switch
        {
            Mnemo.Core.Models.TextSpan t => t.Text,
            EquationSpan e => ConvertLatexToReadableMath(e.Latex),
            FractionSpan f => $"{f.Numerator}/{f.Denominator}",
            _ => string.Empty
        }));

    private static void ComposeSketch(ColumnDescriptor column, Block block, string source, NotePdfExportOptions options)
    {
        if (string.IsNullOrWhiteSpace(source))
            return;

        try
        {
            var result = new SketchCompiler().CompileToSvg(source);
            if (result.Diagnostics.Any(d => d.Severity == SketchDiagnosticSeverity.Error))
            {
                ComposeSketchFallback(column, source, options);
                return;
            }

            var svg = NormalizeSketchSvgForPdf(result.Svg, options);
            var (widthPt, align) = ResolveSketchPdfLayout(block);
            if (widthPt <= 0 && align == "left")
            {
                column.Item()
                    .MaxWidth(MaxSketchPdfWidthPt, Unit.Point)
                    .Svg(svg)
                    .FitWidth();
                return;
            }

            var effectiveWidthPt = widthPt > 0 ? widthPt : MaxSketchPdfWidthPt;
            column.Item().Row(row =>
            {
                if (align == "center" || align == "right")
                    row.RelativeItem();

                row.AutoItem().Element(host =>
                {
                    host
                        .Width(effectiveWidthPt, Unit.Point)
                        .Svg(svg)
                        .FitWidth();
                });

                if (align == "center" || align == "left")
                    row.RelativeItem();
            });
        }
        catch
        {
            ComposeSketchFallback(column, source, options);
        }
    }

    private const float MaxSketchPdfWidthPt = 480f;

    internal static (float WidthPt, string Align) ResolveSketchPdfLayout(Block block)
    {
        if (block.Payload is not SketchPayload payload)
            return (0, "left");

        var widthPt = payload.Width > 0
            ? (float)Math.Clamp(payload.Width * 0.75, 48, MaxSketchPdfWidthPt)
            : 0;
        return (widthPt, NormalizeImageAlign(payload.Align));
    }

    private static void ComposeSketchFallback(ColumnDescriptor column, string source, NotePdfExportOptions options)
    {
        column.Item()
            .Background(Colors.Grey.Lighten4)
            .Padding(10)
            .Text(source)
            .FontFamily("Consolas")
            .FontSize(Math.Max(9f, options.BaseFontSizePt - 1f));
    }

    internal static string NormalizeSketchSvgForPdf(string svg, NotePdfExportOptions options)
    {
        var normalized = svg.Replace(
            "<rect width=\"100%\" height=\"100%\" fill=\"transparent\" />",
            "<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\" />",
            StringComparison.Ordinal);

        if (options.BackgroundSwatchHexByName is not { Count: > 0 } swatches)
            return normalized;

        return Regex.Replace(
            normalized,
            @"theme\(([^)]+)\)",
            match =>
            {
                var token = match.Groups[1].Value.Trim();
                return swatches.TryGetValue(token, out var hex) && !string.IsNullOrWhiteSpace(hex)
                    ? hex.Trim()
                    : match.Value;
            },
            RegexOptions.IgnoreCase);
    }

    private static bool TryResolveSpanColor(
        IReadOnlyDictionary<string, string>? swatchHexByName,
        string? rawStylesheetColor,
        out Color color)
    {
        color = Colors.Transparent;
        if (string.IsNullOrWhiteSpace(rawStylesheetColor))
            return false;

        var token = rawStylesheetColor.Trim();

        if (token.StartsWith("swatch", StringComparison.OrdinalIgnoreCase)
            && swatchHexByName is { } swatches
            && swatches.TryGetValue(token, out var mappedHex)
            && !string.IsNullOrWhiteSpace(mappedHex))
        {
            token = mappedHex.Trim();
        }

        if (!token.StartsWith("#", StringComparison.Ordinal)
            && token.Length == 6
            && Regex.IsMatch(token, "^[0-9A-Fa-f]{6}$", RegexOptions.None))
            token = "#" + token;

        try
        {
            color = Color.FromHex(token);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string ConvertLatexToReadableMath(string latex)
    {
        if (string.IsNullOrWhiteSpace(latex))
            return string.Empty;

        var result = latex.Trim();
        result = result.Trim('$');
        result = result.Replace("\\(", string.Empty, StringComparison.Ordinal)
            .Replace("\\)", string.Empty, StringComparison.Ordinal)
            .Replace("\\[", string.Empty, StringComparison.Ordinal)
            .Replace("\\]", string.Empty, StringComparison.Ordinal);

        result = Regex.Replace(result, @"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", "($1)/($2)");
        result = Regex.Replace(result, @"\^\{([^{}]+)\}", "^$1");
        result = Regex.Replace(result, @"_\{([^{}]+)\}", "_$1");

        foreach (var (command, symbol) in LatexSymbolMap)
            result = result.Replace(command, symbol, StringComparison.Ordinal);

        result = Regex.Replace(result, @"\\([A-Za-z]+)", "$1");
        result = result.Replace(@"\,", " ", StringComparison.Ordinal)
            .Replace(@"\;", " ", StringComparison.Ordinal)
            .Replace(@"\:", " ", StringComparison.Ordinal)
            .Replace(@"\!", string.Empty, StringComparison.Ordinal);
        return result;
    }

    private static readonly (string Command, string Symbol)[] LatexSymbolMap =
    [
        ("\\alpha", "α"),
        ("\\beta", "β"),
        ("\\gamma", "γ"),
        ("\\delta", "δ"),
        ("\\epsilon", "ε"),
        ("\\theta", "θ"),
        ("\\lambda", "λ"),
        ("\\mu", "μ"),
        ("\\pi", "π"),
        ("\\rho", "ρ"),
        ("\\sigma", "σ"),
        ("\\tau", "τ"),
        ("\\phi", "φ"),
        ("\\omega", "ω"),
        ("\\Gamma", "Γ"),
        ("\\Delta", "Δ"),
        ("\\Theta", "Θ"),
        ("\\Lambda", "Λ"),
        ("\\Pi", "Π"),
        ("\\Sigma", "Σ"),
        ("\\Phi", "Φ"),
        ("\\Omega", "Ω"),
        ("\\times", "×"),
        ("\\cdot", "·"),
        ("\\pm", "±"),
        ("\\leq", "≤"),
        ("\\geq", "≥"),
        ("\\neq", "≠"),
        ("\\approx", "≈"),
        ("\\infty", "∞"),
        ("\\sqrt", "√"),
        ("\\sum", "∑"),
        ("\\int", "∫"),
        ("\\rightarrow", "→"),
        ("\\leftarrow", "←"),
        ("\\to", "→")
    ];

    private static void ComposeImage(
        ColumnDescriptor column,
        Block block,
        NotePdfExportOptions options,
        IReadOnlyDictionary<string, NotePdfLatexRaster> latexImages)
    {
        string path = string.Empty;
        double imageWidth = 0;
        var align = "left";
        string? payloadAlt = null;
        if (block.Payload is ImagePayload ip)
        {
            path = ip.Path ?? string.Empty;
            imageWidth = ip.Width;
            align = NormalizeImageAlign(ip.Align);
            payloadAlt = ip.Alt;
        }

        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            if (!string.IsNullOrWhiteSpace(payloadAlt))
                column.Item().Text($"[Image: {payloadAlt}]").Italic().FontColor(Colors.Grey.Medium);
            return;
        }

        try
        {
            var captionSpans = GetImageCaptionSpans(block, payloadAlt);
            var hasCaption = captionSpans.Count > 0 && !string.IsNullOrWhiteSpace(FlattenDisplay(captionSpans));

            column.Item().Row(row =>
            {
                if (align == "center" || align == "right")
                    row.RelativeItem();

                row.AutoItem().Column(stack =>
                {
                    stack.Item().Element(imgHost =>
                    {
                        IContainer c = imgHost;
                        if (imageWidth > 0)
                        {
                            var widthPt = (float)Math.Clamp(imageWidth * 0.75, 48, 520);
                            c = c.Width(widthPt, Unit.Point);
                        }
                        else
                            c = c.MaxWidth(520, Unit.Point);
                        c.Image(path).FitArea();
                    });

                    if (!hasCaption)
                        return;

                    stack.Item().PaddingTop(4).Element(capHost =>
                    {
                        IContainer c = capHost;
                        if (imageWidth > 0)
                            c = c.Width((float)Math.Clamp(imageWidth * 0.75, 48, 520), Unit.Point);
                        else
                            c = c.MaxWidth(520, Unit.Point);
                        c.Text(text =>
                        {
                            text.DefaultTextStyle(x =>
                                x.FontSize(Math.Max(8f, options.BaseFontSizePt - 1f)).FontColor(Colors.Grey.Darken2));
                            ComposeRichText(text, captionSpans, options, latexImages);
                        });
                    });
                });

                if (align == "center" || align == "left")
                    row.RelativeItem();
            });
        }
        catch
        {
            column.Item().Text("[Image could not be embedded]").FontColor(Colors.Grey.Medium);
        }
    }

    private static IReadOnlyList<InlineSpan> GetImageCaptionSpans(Block block, string? payloadAlt)
    {
        block.EnsureSpans();
        if (block.Spans is { Count: > 0 })
        {
            var flat = FlattenDisplay(block.Spans).Trim();
            if (flat.Length > 0)
                return block.Spans;
        }

        if (!string.IsNullOrWhiteSpace(payloadAlt))
            return [InlineSpan.Plain(payloadAlt.Trim())];

        return Array.Empty<InlineSpan>();
    }

    private static string NormalizeImageAlign(string? align) =>
        string.Equals(align, "center", StringComparison.OrdinalIgnoreCase)
            ? "center"
            : string.Equals(align, "right", StringComparison.OrdinalIgnoreCase)
                ? "right"
                : "left";

    private static int ReadListNumberIndex(Block b)
    {
        if (!b.Meta.TryGetValue("listNumberIndex", out var v) || v == null)
            return 1;
        if (v is int i)
            return Math.Max(1, i);
        if (v is long l)
            return Math.Max(1, (int)l);
        if (v is JsonElement je && je.ValueKind == JsonValueKind.Number && je.TryGetInt32(out var n))
            return Math.Max(1, n);
        if (int.TryParse(v.ToString(), out var p))
            return Math.Max(1, p);
        return 1;
    }

    private static bool IsChecklistChecked(Block b)
    {
        if (b.Payload is ChecklistPayload cp)
            return cp.Checked;
        if (b.Meta.TryGetValue("checked", out var v) && v != null)
        {
            if (v is bool bl) return bl;
            if (v is JsonElement je && je.ValueKind is JsonValueKind.True or JsonValueKind.False)
                return je.GetBoolean();
        }
        return false;
    }
}
