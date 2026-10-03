using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using Markdig;
using Markdig.Extensions.Mathematics;
using Markdig.Extensions.Tables;
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

    private static readonly MarkdownPipeline Pipeline = BuildPipeline();

    /// <summary>
    /// The block reader finds tables itself and hands over only text, so a pipe here is a literal
    /// character. Left in, the table extensions read a line holding one as a table and drop the pipes.
    /// </summary>
    private static MarkdownPipeline BuildPipeline()
    {
        var builder = new MarkdownPipelineBuilder().UseAdvancedExtensions();
        builder.Extensions.RemoveAll(extension => extension is PipeTableExtension or GridTableExtension);
        return builder.Build();
    }

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
            // Link definitions have no text of their own, and Markdig appends a group of them
            // for heading anchors, which would otherwise leave a stray line break behind.
            if (block is LinkReferenceDefinitionGroup)
                continue;
            if (!firstBlock)
                spans.Add(InlineSpan.Plain("\n"));
            firstBlock = false;
            AppendBlock(block, spans);
        }

        if (trailingBreaks > 0)
            spans.Add(InlineSpan.Plain(new string('\n', trailingBreaks)));

        var normalized = InlineSpanFormatApplier.Normalize(spans);
        if (normalized.Count == 0)
            normalized.Add(InlineSpan.Plain(string.Empty));
        return normalized;
    }

    /// <summary>
    /// True when the markdown reads as exactly one paragraph, which is what a run of wrapped lines
    /// must still be once joined; anything else is a block whose lines are not prose.
    /// </summary>
    internal static bool ReadsAsOneParagraph(string markdown)
    {
        var doc = global::Markdig.Markdown.Parse(MarkdownHardBreak.SplitTrailing(markdown, out _), Pipeline);
        return doc.Count == 1 && doc[0] is ParagraphBlock;
    }

    /// <summary>
    /// One block's text. Raw HTML keeps the text between its tags, and any other container (a
    /// custom container, a figure, a footnote) keeps its children's text, so nothing written as
    /// prose inside one is dropped.
    /// </summary>
    private static void AppendBlock(Markdig.Syntax.Block block, List<InlineSpan> spans)
    {
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
            case HtmlBlock html:
                var text = HtmlText(LinesToString(html.Lines));
                if (text.Length > 0)
                    spans.Add(new TextSpan(text, TextStyle.Default));
                break;
            case CodeBlock code:
                spans.Add(new TextSpan(LinesToString(code.Lines), TextStyle.Default));
                break;
            case ContainerBlock container:
                AppendBlockContainer(container, spans);
                break;
            case LeafBlock { Inline: { } leafInline }:
                VisitInlines(leafInline, TextStyle.Default, spans);
                break;
        }
    }

    private static void AppendBlockContainer(ContainerBlock container, List<InlineSpan> spans)
    {
        var first = true;
        foreach (var child in container)
        {
            if (child is LinkReferenceDefinitionGroup)
                continue;
            if (!first)
                spans.Add(InlineSpan.Plain("\n"));
            first = false;
            AppendBlock(child, spans);
        }
    }

    /// <summary>A comment, or a script or style element with its body, closed or running to the end.</summary>
    private static readonly Regex HtmlHiddenRegex = new(
        @"<!--.*?(-->|$)|<(script|style)\b.*?(</\2\s*>|$)",
        RegexOptions.Singleline | RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>A tag, skipping any "&gt;" inside a quoted attribute value.</summary>
    private static readonly Regex HtmlTagRegex = new(@"<(?:""[^""]*""|'[^']*'|[^'"">])*>", RegexOptions.Compiled);

    /// <summary>
    /// The text of raw HTML: comments, scripts and styles removed with their bodies, tags removed,
    /// entities decoded, one line per line.
    /// </summary>
    private static string HtmlText(string html)
    {
        var stripped = System.Net.WebUtility.HtmlDecode(HtmlTagRegex.Replace(HtmlHiddenRegex.Replace(html, string.Empty), string.Empty));
        var lines = new List<string>();
        foreach (var line in stripped.Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.Length > 0)
                lines.Add(trimmed);
        }

        return string.Join("\n", lines);
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
