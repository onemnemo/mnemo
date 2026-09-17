using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using Markdig;
using Markdig.Extensions.Mathematics;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes.Markdown;

/// <summary>Parses inline markdown into <see cref="InlineSpan"/> lists using Markdig.</summary>
public static class InlineMarkdownParser
{
    private static readonly Regex FractionTokenRegex = new(
        @"\\(\d+)/(\d+)",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .Build();

    public static List<InlineSpan> ToSpans(string? markdown)
    {
        if (string.IsNullOrEmpty(markdown))
            return new List<InlineSpan> { InlineSpan.Plain(string.Empty) };

        // A hard break with nothing after it is a literal backslash to CommonMark, but the writer
        // only ever emits one for a newline, so the trailing ones are restored as such.
        var text = MarkdownHardBreak.SplitTrailing(markdown, out var trailingBreaks);
        var doc = global::Markdig.Markdown.Parse(text, Pipeline);
        var spans = new List<InlineSpan>();
        var firstBlock = true;
        foreach (var block in doc)
        {
            if (!firstBlock)
                spans.Add(InlineSpan.Plain("\n"));
            firstBlock = false;

            switch (block)
            {
                case ParagraphBlock paragraph:
                    VisitInlines(paragraph.Inline, TextStyle.Default, spans);
                    break;
                case HeadingBlock heading:
                    VisitInlines(heading.Inline, TextStyle.Default, spans);
                    break;
                case ThematicBreakBlock:
                    break;
                case FencedCodeBlock fenced:
                    spans.Add(new TextSpan(LinesToString(fenced.Lines), TextStyle.Default));
                    break;
                case CodeBlock cb:
                    spans.Add(new TextSpan(LinesToString(cb.Lines), TextStyle.Default));
                    break;
                case QuoteBlock quote:
                    AppendBlockContainer(quote, spans);
                    break;
                case ListBlock list:
                    AppendBlockContainer(list, spans);
                    break;
                default:
                    if (block is LeafBlock { Inline: { } leafInline })
                        VisitInlines(leafInline, TextStyle.Default, spans);
                    break;
            }
        }

        if (trailingBreaks > 0)
            spans.Add(InlineSpan.Plain(new string('\n', trailingBreaks)));

        var normalized = InlineSpanFormatApplier.Normalize(spans);
        if (normalized.Count == 0)
            normalized.Add(InlineSpan.Plain(string.Empty));
        return normalized;
    }

    private static void AppendBlockContainer(ContainerBlock container, List<InlineSpan> spans)
    {
        var first = true;
        foreach (var child in container)
        {
            if (!first)
                spans.Add(InlineSpan.Plain("\n"));
            first = false;
            if (child is ParagraphBlock p)
                VisitInlines(p.Inline, TextStyle.Default, spans);
            else if (child is QuoteBlock q)
                AppendBlockContainer(q, spans);
            else if (child is ListBlock l)
                AppendBlockContainer(l, spans);
            else if (child is ListItemBlock item)
                AppendBlockContainer(item, spans);
            else if (child is LeafBlock { Inline: { } inline })
                VisitInlines(inline, TextStyle.Default, spans);
        }
    }

    private static void VisitInlines(Inline? inline, TextStyle style, List<InlineSpan> spans)
    {
        if (inline == null) return;

        switch (inline)
        {
            case LiteralInline literal:
                if (literal.Content.Length > 0)
                    AppendLiteralWithFractions(literal.Content.ToString(), style, spans);
                break;

            case CodeInline code:
                spans.Add(new TextSpan(code.Content, style.WithSet(InlineFormatKind.Code)));
                break;

            case EmphasisInline emphasis:
                VisitEmphasis(emphasis, style, spans);
                break;

            case LineBreakInline:
                spans.Add(new TextSpan("\n", style));
                break;

            case LinkInline link:
            {
                var href = link.Url ?? string.Empty;
                var linkedStyle = string.IsNullOrEmpty(href)
                    ? style
                    : style.WithSet(InlineFormatKind.Link, InlineAutoLink.NormalizeUrl(href));
                foreach (var c in link)
                    VisitInlines(c, linkedStyle, spans);
                break;
            }

            case AutolinkInline auto:
            {
                var raw = auto.Url ?? string.Empty;
                var href = InlineAutoLink.NormalizeUrl(raw);
                spans.Add(new TextSpan(raw, style.WithSet(InlineFormatKind.Link, href)));
                break;
            }

            case MathInline math:
            {
                var latex = math.Content.ToString().Trim();
                if (!string.IsNullOrEmpty(latex))
                    spans.Add(new EquationSpan(latex));
                break;
            }

            case HtmlInline:
                break;

            case ContainerInline container:
                foreach (var c in container)
                    VisitInlines(c, style, spans);
                break;
        }
    }

    private static string LinesToString(Markdig.Helpers.StringLineGroup lines)
    {
        var sb = new StringBuilder();
        var i = 0;
        foreach (var line in lines)
        {
            if (i++ > 0) sb.AppendLine();
            sb.Append(line.ToString());
        }
        return sb.ToString();
    }

    private static void VisitEmphasis(EmphasisInline emphasis, TextStyle style, List<InlineSpan> spans)
    {
        var next = emphasis.DelimiterChar switch
        {
            '~' when emphasis.DelimiterCount >= 2 => style with { Strikethrough = true },
            '*' or '_' => emphasis.DelimiterCount switch
            {
                >= 3 => style with { Bold = true, Italic = true },
                2 => style with { Bold = true },
                _ => style with { Italic = true }
            },
            _ => style
        };

        foreach (var c in emphasis)
            VisitInlines(c, next, spans);
    }

    private static void AppendLiteralWithFractions(string text, TextStyle style, List<InlineSpan> spans)
    {
        var pos = 0;
        foreach (Match m in FractionTokenRegex.Matches(text))
        {
            if (!m.Success)
                continue;

            if (m.Index > pos)
                spans.Add(new TextSpan(text[pos..m.Index], style));

            if (int.TryParse(m.Groups[1].Value, out var num)
                && int.TryParse(m.Groups[2].Value, out var den)
                && den > 0)
            {
                spans.Add(new FractionSpan(num, den, style));
            }
            else
            {
                spans.Add(new TextSpan(m.Value, style));
            }

            pos = m.Index + m.Length;
        }

        if (pos < text.Length)
            spans.Add(new TextSpan(text[pos..], style));
    }
}
