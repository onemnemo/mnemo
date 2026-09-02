using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Core.Sketch;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Services.Notes.Pdf;

/// <summary>
/// Maps a <see cref="Note"/> to a Typst source document, dispatching per <see cref="BlockType"/>.
/// Math renders through mitex as vector glyphs; there is no LaTeX-to-Unicode degrade.
///
/// Every escaping and mitex-fencing rule here was verified against the pinned typst 0.15.1 binary.
/// </summary>
internal static class NoteTypstDocumentComposer
{
    private const string MitexImport = "@preview/mitex:0.2.7";

    // Embedded fonts (New Computer Modern / Libertinus / DejaVu) carry no bullet glyph, so the list
    // marker is drawn rather than typeset. This renders on every machine regardless of system fonts.
    private const string BulletMarker = "box(baseline: -0.05em, circle(radius: 0.11em, fill: black))";

    /// <summary>
    /// The ring and the square the editor draws one and two levels down a nested list; past the
    /// third level the cycle repeats, as it does on screen.
    /// </summary>
    private const string RingMarker = "box(baseline: -0.05em, circle(radius: 0.11em, stroke: 0.6pt + black))";
    private const string SquareMarker = "box(baseline: -0.05em, rect(width: 0.2em, height: 0.2em, fill: black))";

    private static string BulletMarkerAt(int listDepth) => (listDepth % 3) switch
    {
        1 => RingMarker,
        2 => SquareMarker,
        _ => BulletMarker
    };

    /// <summary>
    /// Letters one level down and roman numerals two, matching the editor's labels; null at the
    /// top, which keeps Typst's default and the exact output every existing list has.
    /// </summary>
    private static string? EnumNumberingAt(int listDepth) => (listDepth % 3) switch
    {
        1 => "a.",
        2 => "i.",
        _ => null
    };

    public static string Compose(Note note, NotePdfExportOptions options, INoteTypstAssetResolver? assets = null)
    {
        var blocks = GetOrderedBlocksForExport(note);
        var sb = new StringBuilder(4096);

        EmitPreamble(sb, note, options);

        var titled = options.IncludeNoteTitle && !string.IsNullOrWhiteSpace(note.Title);
        if (titled)
        {
            sb.Append("#text(weight: 600, size: ")
              .Append(Pt(options.BaseFontSizePt + 8f))
              .Append(")[").Append(EscapeMarkup(note.Title.Trim())).Append("]\n\n");
        }

        var tagged = EmitTags(sb, note, options);

        // The rule closes off whatever masthead there was. Without a title or tags there is nothing
        // above it, and a line across the top of the first page is just a line.
        if (titled || tagged)
            sb.Append("#line(length: 100%, stroke: 0.5pt + rgb(\"#d0d0d0\"))\n\n");

        foreach (var block in blocks)
            EmitBlock(sb, block, options, assets);

        return sb.ToString();
    }

    private static void EmitPreamble(StringBuilder sb, Note note, NotePdfExportOptions options)
    {
        sb.Append("#import \"").Append(MitexImport).Append("\": mitex\n");

        if (!string.IsNullOrWhiteSpace(note.Title))
            sb.Append("#set document(title: \"").Append(EscapeString(note.Title.Trim())).Append("\")\n");

        var paper = options.Paper switch
        {
            NotePdfPaperKind.Letter => "us-letter",
            NotePdfPaperKind.Legal => "us-legal",
            NotePdfPaperKind.A5 => "a5",
            _ => "a4"
        };
        var marginCm = options.Margin switch
        {
            NotePdfMarginPreset.Narrow => "1.27cm",
            NotePdfMarginPreset.Wide => "3.18cm",
            _ => "2cm"
        };
        sb.Append("#set page(paper: \"").Append(paper).Append("\", margin: ").Append(marginCm);
        if (options.Landscape)
            sb.Append(", flipped: true");

        if (options.PageNumberAlignment != NotePdfPageNumberAlignment.None)
        {
            var align = options.PageNumberAlignment switch
            {
                NotePdfPageNumberAlignment.Left => "left",
                NotePdfPageNumberAlignment.Right => "right",
                _ => "center"
            };
            sb.Append(", numbering: ").Append(PageNumberPattern(options)).Append(", number-align: ").Append(align);
        }

        sb.Append(")\n");
        // Geist (the app's UI face) with the embedded serif as a fallback, so a PDF reads like the
        // note on screen instead of a LaTeX paper. Code uses Geist Mono to match the editor.
        sb.Append("#set text(font: (\"Geist\", \"New Computer Modern\"), size: ")
          .Append(Pt(options.BaseFontSizePt)).Append(", fill: rgb(\"#000000\"))\n");
        sb.Append("#show raw: set text(font: (\"Geist Mono\", \"DejaVu Sans Mono\"))\n");
        sb.Append("#set par(leading: 0.65em)\n");
        sb.Append("#set block(spacing: 10pt)\n\n");
    }

    /// <summary>
    /// What Typst puts in the page footer.
    /// </summary>
    /// <remarks>
    /// The first two are patterns, where a digit is a counter and everything else is literal. The
    /// worded form cannot be: a pattern reads <c>a</c>, <c>i</c> and friends as counters too, so
    /// "Page 1 of 1" prints as "Pbge 7". Words go through a function instead, where the literal parts
    /// are ordinary content and only the two accessors count anything.
    /// </remarks>
    private static string PageNumberPattern(NotePdfExportOptions options)
    {
        if (options.PageNumberFormat == NotePdfPageNumberFormat.CurrentPage)
            return "\"1\"";
        if (options.PageNumberFormat == NotePdfPageNumberFormat.CurrentAndTotalPages)
            return "\"1 / 1\"";

        var format = options.PageNumberWordedFormat;
        if (!format.Contains("{0}", StringComparison.Ordinal) || !format.Contains("{1}", StringComparison.Ordinal))
            format = new NotePdfExportOptions().PageNumberWordedFormat;

        var body = new StringBuilder();
        foreach (var part in Regex.Split(format, @"(\{[01]\})"))
        {
            if (part.Length == 0)
                continue;
            body.Append(part switch
            {
                "{0}" => "#n.pos().at(0)",
                "{1}" => "#n.pos().at(1)",
                _ => EscapeMarkup(part)
            });
        }

        // Variadic because a page numbering function is handed the page and the total together.
        return "(..n) => [" + body + "]";
    }

    /// <summary>The note's tags as tinted pills under its title. Returns whether anything was drawn.</summary>
    private static bool EmitTags(StringBuilder sb, Note note, NotePdfExportOptions options)
    {
        if (!options.IncludeTags || note.Tags is not { Count: > 0 })
            return false;

        var tags = note.Tags
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Select(t => t.Trim())
            .ToList();
        if (tags.Count == 0)
            return false;

        var size = Pt(Math.Max(7.5f, options.BaseFontSizePt - 2f));
        sb.Append("#block(below: 8pt)[");
        for (var i = 0; i < tags.Count; i++)
        {
            // A plain space between the pills, not #h: a run of tags has to be allowed to wrap.
            if (i > 0)
                sb.Append(' ');

            // The same hue-per-label the editor's chips use, at the lightness a white page wants.
            var hue = HueOf(tags[i]).ToString(CultureInfo.InvariantCulture);
            var fill = options.RenderColors ? $"oklch(93%, 0.055, {hue}deg)" : "rgb(\"#f2f2f3\")";
            var ink = options.RenderColors ? $"oklch(42%, 0.11, {hue}deg)" : "rgb(\"#5f5f5f\")";

            sb.Append("#box(fill: ").Append(fill)
              .Append(", inset: (x: 5pt, y: 2.5pt), outset: (y: 1.5pt), radius: 999pt)")
              .Append("[#text(size: ").Append(size).Append(", fill: ").Append(ink).Append(")[")
              .Append(EscapeMarkup(tags[i])).Append("]]");
        }
        sb.Append("]\n\n");
        return true;
    }

    // Mirrors the editor's tag chips so a tag keeps its colour from screen to paper.
    private static int HueOf(string label)
    {
        var hash = 0;
        foreach (var c in label)
            hash = (hash * 31 + c) % 360;
        return hash;
    }

    // Prefer structured blocks, fall back to the markdown content string, then to a single text
    // block, so a note from any era still renders.
    internal static List<Block> GetOrderedBlocksForExport(Note note)
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
            new Block { Id = Guid.NewGuid().ToString(), Type = BlockType.Text, Spans = [InlineSpan.Plain(raw)], Order = 0 }
        ];
    }

    /// <summary>
    /// <paramref name="listDepth"/> is how many list items enclose the block, which decides a
    /// nested item's marker and numbering style.
    /// </summary>
    private static void EmitBlock(StringBuilder sb, Block block, NotePdfExportOptions options, INoteTypstAssetResolver? assets, int listDepth = 0)
    {
        switch (block.Type)
        {
            case BlockType.Page:
                if (options.RenderSubpageLinks)
                    EmitSubpage(sb, block, options);
                return;
            case BlockType.ColumnGroup:
                if (block.Children is { Count: > 0 })
                {
                    foreach (var child in block.Children.OrderBy(c => c.Order).ThenBy(c => c.Id))
                        EmitBlock(sb, child, options, assets, listDepth);
                }
                return;
            case BlockType.TwoColumn:
                EmitTwoColumn(sb, block, options, assets);
                return;
            default:
                EmitLeafBlock(sb, block, options, assets, listDepth);
                return;
        }
    }

    /// <summary>
    /// An item's nested list, inside the item's own content so Typst indents it under the text.
    /// Nothing is emitted for a leaf, so an item without children keeps its exact output.
    /// </summary>
    private static void EmitNestedItems(StringBuilder sb, Block item, NotePdfExportOptions options, INoteTypstAssetResolver? assets, int listDepth)
    {
        if (item.Children is not { Count: > 0 })
            return;

        sb.Append('\n');
        foreach (var child in item.Children.OrderBy(c => c.Order).ThenBy(c => c.Id))
            EmitBlock(sb, child, options, assets, listDepth);
    }

    private static void EmitTwoColumn(StringBuilder sb, Block block, NotePdfExportOptions options, INoteTypstAssetResolver? assets)
    {
        var ratio = 0.5;
        if (MatchedPayload<TwoColumnPayload>(block) is { } tcp)
            ratio = Math.Clamp(tcp.SplitRatio, 0.1, 0.9);

        var children = block.Children;
        var left = children is { Count: > 0 } ? children[0] : null;
        var right = children is { Count: > 1 } ? children[1] : null;

        sb.Append("#grid(columns: (").Append(Num(ratio)).Append("fr, ").Append(Num(1 - ratio)).Append("fr), gutter: 12pt,\n");
        sb.Append("[\n").Append(RenderColumnCell(left, options, assets)).Append("],\n");
        sb.Append("[\n").Append(RenderColumnCell(right, options, assets)).Append("])\n\n");
    }

    private static string RenderColumnCell(Block? group, NotePdfExportOptions options, INoteTypstAssetResolver? assets)
    {
        if (group == null)
            return string.Empty;

        var cell = new StringBuilder();
        if (group.Type == BlockType.ColumnGroup && group.Children is { Count: > 0 })
        {
            foreach (var child in group.Children.OrderBy(c => c.Order).ThenBy(c => c.Id))
                EmitBlock(cell, child, options, assets);
        }
        else
            EmitBlock(cell, group, options, assets);

        return cell.ToString();
    }

    private static void EmitLeafBlock(StringBuilder sb, Block block, NotePdfExportOptions options, INoteTypstAssetResolver? assets, int listDepth = 0)
    {
        block.EnsureSpans();

        switch (block.Type)
        {
            case BlockType.Heading1:
                EmitHeading(sb, block, options, options.BaseFontSizePt + 10f);
                break;
            case BlockType.Heading2:
                EmitHeading(sb, block, options, options.BaseFontSizePt + 6f);
                break;
            case BlockType.Heading3:
                EmitHeading(sb, block, options, options.BaseFontSizePt + 3f);
                break;
            case BlockType.Heading4:
                EmitHeading(sb, block, options, options.BaseFontSizePt + 1.5f);
                break;
            case BlockType.BulletList:
                sb.Append("#list(marker: ").Append(BulletMarkerAt(listDepth)).Append(")[");
                EmitInline(sb, block.Spans, options);
                EmitNestedItems(sb, block, options, assets, listDepth + 1);
                sb.Append("]\n\n");
                break;
            case BlockType.NumberedList:
            {
                sb.Append("#enum(start: ").Append(ReadListNumberIndex(block));
                var numbering = EnumNumberingAt(listDepth);
                if (numbering != null)
                    sb.Append(", numbering: \"").Append(numbering).Append('"');
                sb.Append(")[");
                EmitInline(sb, block.Spans, options);
                EmitNestedItems(sb, block, options, assets, listDepth + 1);
                sb.Append("]\n\n");
                break;
            }
            case BlockType.Checklist:
                // ASCII markers render on every font; a real checkbox glyph would not.
                sb.Append(IsChecklistChecked(block) ? "\\[x\\] " : "\\[ \\] ");
                EmitInline(sb, block.Spans, options);
                sb.Append("\n\n");
                if (block.Children is { Count: > 0 })
                {
                    // A checkbox item is a paragraph, not a list function, so its nested list is
                    // indented by hand to sit where a list's own would.
                    sb.Append("#pad(left: 1.5em)[\n");
                    EmitNestedItems(sb, block, options, assets, listDepth + 1);
                    sb.Append("]\n\n");
                }
                break;
            case BlockType.Quote:
                sb.Append("#block(inset: (left: 10pt), stroke: (left: 3pt + rgb(\"#9e9e9e\")))[#emph[");
                EmitInline(sb, block.Spans, options);
                sb.Append("]]\n\n");
                break;
            case BlockType.Callout:
            {
                // The embedded fonts carry no emoji glyphs, so the tone is carried by the tint
                // rather than by the leading character the editor draws.
                var warn = string.Equals(MatchedPayload<CalloutPayload>(block)?.Tone, "warn", StringComparison.OrdinalIgnoreCase);
                sb.Append("#block(width: 100%, inset: 8pt, radius: 3pt, fill: rgb(\"")
                  .Append(warn ? "#fbf0d5" : "#f2f2f3")
                  .Append("\"))[");
                EmitInline(sb, block.Spans, options);
                sb.Append("]\n\n");
                break;
            }
            case BlockType.Code:
                EmitCode(sb, block, options);
                break;
            case BlockType.Divider:
                sb.Append("#line(length: 100%, stroke: 0.5pt + rgb(\"#cfcfcf\"))\n\n");
                break;
            case BlockType.Equation:
            {
                var latex = MatchedPayload<EquationPayload>(block)?.Latex ?? block.Content;
                sb.Append("#block[");
                EmitMitex(sb, latex, displayStyle: true);
                sb.Append("]\n\n");
                break;
            }
            case BlockType.Image:
                if (options.RenderImages)
                    EmitImage(sb, block, options, assets);
                break;
            case BlockType.Sketch:
                if (options.RenderImages)
                    EmitSketch(sb, block, options);
                break;
            case BlockType.Table:
                EmitTable(sb, block, options);
                break;
            case BlockType.Text:
            default:
                if (!string.IsNullOrWhiteSpace(block.Content))
                {
                    EmitInline(sb, block.Spans, options);
                    sb.Append("\n\n");
                }
                break;
        }
    }

    /// <summary>
    /// A sub-page row. On paper it cannot be followed, so it prints as what it is by then: the name
    /// of something that lives elsewhere. The leading glyph is drawn rather than typeset, for the same
    /// reason the list bullet is, and the underline is a rule under a name rather than link blue.
    /// </summary>
    private static void EmitSubpage(StringBuilder sb, Block block, NotePdfExportOptions options)
    {
        var reference = MatchedPayload<PagePayload>(block)?.ReferenceNoteId;
        var title = ResolveSubpageTitle(reference, options);

        sb.Append("#block[")
          .Append("#box(baseline: 0.08em, rect(width: 0.58em, height: 0.76em, radius: 1pt, stroke: 0.6pt + rgb(\"#9e9e9e\")))")
          .Append("#h(0.45em)")
          .Append("#underline(stroke: 0.5pt + rgb(\"#cfcfcf\"), offset: 2.5pt)[#text(fill: rgb(\"#3f3f3f\"))[")
          .Append(EscapeMarkup(title))
          .Append("]]]\n\n");
    }

    private static string ResolveSubpageTitle(string? referenceNoteId, NotePdfExportOptions options)
    {
        if (!string.IsNullOrWhiteSpace(referenceNoteId)
            && options.SubpageTitlesById is { } titles
            && titles.TryGetValue(referenceNoteId, out var title)
            && !string.IsNullOrWhiteSpace(title))
        {
            return title.Trim();
        }
        return options.MissingSubpageTitle;
    }

    private static void EmitHeading(StringBuilder sb, Block block, NotePdfExportOptions options, float sizePt)
    {
        sb.Append("#text(weight: \"bold\", size: ").Append(Pt(sizePt)).Append(")[");
        EmitInline(sb, block.Spans, options);
        sb.Append("]\n\n");
    }

    private static void EmitCode(StringBuilder sb, Block block, NotePdfExportOptions options)
    {
        var payload = MatchedPayload<CodePayload>(block);
        var source = payload?.Source ?? block.Content;
        var lang = payload?.Language;

        sb.Append("#block(fill: rgb(\"#f2f2f2\"), inset: 10pt, width: 100%, radius: 3pt)[#raw(\"")
          .Append(EscapeString(source))
          .Append("\", block: true");
        if (!string.IsNullOrWhiteSpace(lang))
            sb.Append(", lang: \"").Append(EscapeString(lang.Trim())).Append('"');
        sb.Append(")]\n");

        // Same rank and colour as a figure's caption, because it is the same thing:
        // the line that says what the reader is looking at.
        var caption = payload?.Caption;
        if (!string.IsNullOrWhiteSpace(caption))
        {
            sb.Append("#v(4pt)#text(size: ").Append(Pt(Math.Max(8f, options.BaseFontSizePt - 1f)))
              .Append(", fill: rgb(\"#5f5f5f\"))[").Append(EscapeMarkup(caption.Trim())).Append("]\n");
        }

        sb.Append('\n');
    }

    /// <summary>
    /// A table, as Typst's own.
    /// </summary>
    /// <remarks>
    /// Column widths are emitted as fractions of the measure rather than in points: the editor's
    /// pixels mean nothing on A5 in landscape, but the proportions the user set are exactly what they
    /// were choosing. A header row and header column are drawn as the editor draws them, on the
    /// sunken surface, so the printed table reads the same way as the one on screen. Per-cell tints
    /// are not carried: the palette is a screen palette, and eight pastel fills is what turns a page
    /// into a printer test.
    /// </remarks>
    private static void EmitTable(StringBuilder sb, Block block, NotePdfExportOptions options)
    {
        var rows = (block.Children ?? []).OrderBy(r => r.Order).ToList();
        if (rows.Count == 0)
            return;

        var columns = rows.Max(r => r.Children?.Count ?? 0);
        if (columns == 0)
            return;

        var payload = MatchedPayload<TablePayload>(block);
        var widths = payload?.ColumnWidths ?? [];
        var total = 0d;
        for (var i = 0; i < columns; i++)
            total += i < widths.Count && widths[i] > 0 ? widths[i] : 1;

        sb.Append("#table(\n  columns: (");
        for (var i = 0; i < columns; i++)
        {
            var width = i < widths.Count && widths[i] > 0 ? widths[i] : 1;
            if (i > 0)
                sb.Append(", ");
            sb.Append(Num(width / total * 100)).Append('%');
        }

        sb.Append("),\n  inset: 6pt,\n  stroke: 0.5pt + rgb(\"#d4d4d4\"),\n");
        // Any row or column can be a header, so the shade is looked up from a flag
        // per row and per column rather than pinned to the first of each.
        sb.Append("  fill: (column, row) => if ")
          .Append(TypstBoolArray(payload?.HeaderRows, rows.Count)).Append(".at(row) or ")
          .Append(TypstBoolArray(payload?.HeaderColumns, columns)).Append(".at(column)")
          .Append(" { rgb(\"#f2f2f2\") } else { none },\n");

        foreach (var row in rows)
        {
            var cells = (row.Children ?? []).OrderBy(c => c.Order).ToList();
            for (var i = 0; i < columns; i++)
            {
                sb.Append("  [");
                if (i < cells.Count)
                    EmitInline(sb, cells[i].Spans, options);
                sb.Append("],\n");
            }
        }

        sb.Append(")\n\n");
    }

    /// <summary>
    /// A Typst boolean array of exactly <paramref name="count"/> entries, so <c>fill</c> can index
    /// it by row or column. A one-element array needs the trailing comma or Typst reads it as a
    /// parenthesised boolean rather than an array.
    /// </summary>
    private static string TypstBoolArray(IReadOnlyList<bool>? flags, int count)
    {
        var sb = new StringBuilder("(");
        for (var i = 0; i < count; i++)
        {
            if (i > 0)
                sb.Append(", ");
            sb.Append(flags is not null && i < flags.Count && flags[i] ? "true" : "false");
        }

        if (count == 1)
            sb.Append(',');
        sb.Append(')');
        return sb.ToString();
    }

    private static void EmitImage(StringBuilder sb, Block block, NotePdfExportOptions options, INoteTypstAssetResolver? assets)
    {
        var payload = MatchedPayload<ImagePayload>(block);
        var reference = payload?.Path ?? string.Empty;
        var align = NormalizeAlign(payload?.Align);
        var alt = payload?.Alt;

        var resolved = string.IsNullOrWhiteSpace(reference) ? null : assets?.ResolveImagePath(reference);
        if (resolved == null)
        {
            if (!string.IsNullOrWhiteSpace(alt))
                sb.Append("#text(style: \"italic\", fill: rgb(\"#757575\"))[\\[Image: ")
                  .Append(EscapeMarkup(alt.Trim())).Append("\\]]\n\n");
            return;
        }

        var captionSpans = GetImageCaptionSpans(block, alt);
        var widthAttr = payload is { Width: > 0 }
            ? $", width: {Pt((float)Math.Clamp(payload.Width * 0.75, 48, 520))}"
            : string.Empty;

        sb.Append("#align(").Append(align).Append(")[");
        if (payload?.Crop is { } crop)
            AppendCroppedImage(sb, resolved, crop, payload.Width);
        else
            sb.Append("#image(\"").Append(EscapeString(resolved)).Append('"').Append(widthAttr).Append(')');
        if (captionSpans.Count > 0)
        {
            sb.Append("#v(4pt)#text(size: ").Append(Pt(Math.Max(8f, options.BaseFontSizePt - 1f)))
              .Append(", fill: rgb(\"#5f5f5f\"))[");
            EmitInline(sb, captionSpans, options);
            sb.Append(']');
        }
        sb.Append("]\n\n");
    }

    /// <summary>
    /// A cropped image, as a frame the picture is placed behind and clipped to.
    ///
    /// Typst has no crop, so the window is built from what it does have: a box of the frame's shape
    /// with <c>clip</c>, holding the whole image scaled up by the reciprocal of the window and
    /// shifted so the window's top left lands on the frame's. <c>fit: "stretch"</c> is not optional:
    /// the default re-fits the image inside the box and undoes exactly the scaling this depends on.
    ///
    /// The frame needs an absolute width, because Typst cannot derive a height from a ratio without
    /// one, and an image that was never resized has no stored width. That case reads the available
    /// width off <c>layout</c> instead, which is the same rule the editor draws by, where an
    /// unresized cropped image takes the column.
    /// </summary>
    private static void AppendCroppedImage(StringBuilder sb, string resolved, ImageCrop crop, double width)
    {
        var frame = width > 0
            ? Pt((float)Math.Clamp(width * 0.75, 48, 520))
            : "size.width";

        sb.Append("#layout(size => { let fw = ").Append(frame)
          .Append("; let fh = fw / ").Append(Ratio(crop.Aspect))
          .Append("; box(width: fw, height: fh, clip: true, place(top + left, dx: -")
          .Append(Ratio(crop.X / crop.W)).Append(" * fw, dy: -")
          .Append(Ratio(crop.Y / crop.H)).Append(" * fh, image(\"")
          .Append(EscapeString(resolved))
          .Append("\", width: fw / ").Append(Ratio(crop.W))
          .Append(", height: fh / ").Append(Ratio(crop.H))
          .Append(", fit: \"stretch\"))) })");
    }

    private static void EmitSketch(StringBuilder sb, Block block, NotePdfExportOptions options)
    {
        var source = block.Content;
        if (string.IsNullOrWhiteSpace(source))
            return;

        string svg;
        try
        {
            var result = new SketchCompiler().CompileToSvg(source);
            if (result.Diagnostics.Any(d => d.Severity == SketchDiagnosticSeverity.Error))
            {
                EmitSketchFallback(sb, source, options);
                return;
            }
            svg = NormalizeSketchSvgForPdf(result.Svg, options);
        }
        catch
        {
            EmitSketchFallback(sb, source, options);
            return;
        }

        var (widthPt, align) = ResolveSketchPdfLayout(block);

        sb.Append("#align(").Append(align).Append(")[");
        if (widthPt > 0)
            sb.Append("#box(width: ").Append(Pt(widthPt)).Append(")[");
        // SVG bytes embed in-memory; image.decode does not exist in typst 0.15.
        sb.Append("#image(bytes(\"").Append(EscapeString(svg)).Append("\"), format: \"svg\")");
        if (widthPt > 0)
            sb.Append(']');
        sb.Append("]\n\n");
    }

    private static void EmitSketchFallback(StringBuilder sb, string source, NotePdfExportOptions options)
    {
        sb.Append("#block(fill: rgb(\"#f2f2f2\"), inset: 10pt, width: 100%, radius: 3pt)[#raw(\"")
          .Append(EscapeString(source)).Append("\", block: true)]\n\n");
    }

    // === Inline content ===

    private static void EmitInline(StringBuilder sb, IReadOnlyList<InlineSpan> spans, NotePdfExportOptions options)
    {
        foreach (var span in spans)
        {
            switch (span)
            {
                case TextSpan text:
                    sb.Append(StyleFragment(BaseText(text.Text, text.Style), text.Style, options));
                    break;
                case EquationSpan equation:
                {
                    var inner = new StringBuilder();
                    EmitMitex(inner, equation.Latex, displayStyle: false);
                    sb.Append(StyleFragment(inner.ToString(), equation.Style with { Code = false }, options));
                    break;
                }
                case FractionSpan fraction:
                {
                    var inner = new StringBuilder();
                    // Numerator/denominator are integers, so the LaTeX can never contain a backtick.
                    EmitMitex(inner, $"\\frac{{{fraction.Numerator}}}{{{fraction.Denominator}}}", displayStyle: false);
                    sb.Append(StyleFragment(inner.ToString(), fraction.Style with { Code = false }, options));
                    break;
                }
            }
        }
    }

    // A code-styled span becomes inline #raw (verbatim, no markup); everything else is escaped markup.
    private static string BaseText(string content, TextStyle style) =>
        style.Code
            ? $"#highlight(fill: rgb(\"#eeeeee\"))[#raw(\"{EscapeString(content)}\")]"
            : EscapeMarkup(content);

    private static string StyleFragment(string fragment, TextStyle style, NotePdfExportOptions options)
    {
        if (style.Bold)
            fragment = $"#strong[{fragment}]";
        if (style.Italic)
            fragment = $"#emph[{fragment}]";
        if (style.Strikethrough)
            fragment = $"#strike[{fragment}]";
        if (style.Subscript)
            fragment = $"#sub[{fragment}]";
        if (style.Superscript)
            fragment = $"#super[{fragment}]";

        var hasLink = !string.IsNullOrWhiteSpace(style.LinkUrl);
        if (style.Underline || hasLink)
            fragment = $"#underline[{fragment}]";

        if (options.RenderColors)
        {
            if (style.Highlight)
                fragment = $"#highlight[{fragment}]";
            if (ResolveSwatchColor(options.BackgroundSwatchHexByName, style.BackgroundColor) is { } bg)
                fragment = $"#highlight(fill: rgb(\"{bg}\"))[{fragment}]";
        }

        // Foreground wins over link blue. Link color applies even when colors are otherwise
        // suppressed, since a link must read as a link.
        var fg = options.RenderColors ? ResolveSwatchColor(options.ForegroundSwatchHexByName, style.ForegroundColor) : null;
        var colorHex = fg ?? (hasLink ? "#1d4ed8" : null);
        if (colorHex != null)
            fragment = $"#text(fill: rgb(\"{colorHex}\"))[{fragment}]";

        if (hasLink && IsSafeLinkUrl(style.LinkUrl!))
            fragment = $"#link(\"{EscapeString(style.LinkUrl!.Trim())}\")[{fragment}]";

        return fragment;
    }

    // Emits a mitex call, guarding the raw block against backticks in the LaTeX. No backtick uses a
    // single-backtick inline raw; a backtick present forces a block fence (>= 3, longest run + 1)
    // with a leading newline so Typst does not read leading LaTeX as a raw language tag.
    private static void EmitMitex(StringBuilder sb, string? latex, bool displayStyle)
    {
        var body = LatexUnicode.Normalize((latex ?? string.Empty).Trim());
        if (displayStyle && body.Length > 0)
            body = "\\displaystyle " + body;

        sb.Append("#mitex(");
        if (!body.Contains('`'))
        {
            sb.Append('`').Append(body).Append('`');
        }
        else
        {
            var fence = new string('`', Math.Max(3, LongestBacktickRun(body) + 1));
            sb.Append(fence).Append('\n').Append(body).Append('\n').Append(fence);
        }
        sb.Append(')');
    }

    private static int LongestBacktickRun(string s)
    {
        int longest = 0, current = 0;
        foreach (var c in s)
        {
            if (c == '`') current++;
            else current = 0;
            if (current > longest) longest = current;
        }
        return longest;
    }

    // === Escaping (verified against typst 0.15.1) ===

    // Prefix a backslash before every Typst markup metacharacter. Over-escaping the sequence markers
    // (- + = / .) is harmless: the binary renders each escaped char literally, which sidesteps any
    // line-start / content-start ambiguity without tracking position.
    private static string EscapeMarkup(string text)
    {
        if (string.IsNullOrEmpty(text))
            return string.Empty;

        var sb = new StringBuilder(text.Length + 8);
        foreach (var c in text)
        {
            switch (c)
            {
                case '\\': case '#': case '$': case '*': case '_': case '`':
                case '[': case ']': case '<': case '>': case '@': case '~':
                case '=': case '-': case '+': case '/': case '.':
                    sb.Append('\\').Append(c);
                    break;
                default:
                    sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    // Typst string-literal escaping. A literal backslash is doubled first, so LaTeX/code escapes like
    // \t or \n survive as text instead of being reinterpreted as control characters. Newlines stay
    // literal so multi-line code blocks keep their line breaks.
    private static string EscapeString(string text)
    {
        if (string.IsNullOrEmpty(text))
            return string.Empty;

        return text.Replace("\\", "\\\\", StringComparison.Ordinal)
                   .Replace("\"", "\\\"", StringComparison.Ordinal);
    }

    // === Payload / meta helpers ===

    // Type and Payload.kind can legally disagree in the wire format. Returning the payload only when
    // it matches the block's type keeps the composer from ever rendering the wrong-kind data; a
    // mismatched payload is ignored and the block falls back to its spans.
    private static T? MatchedPayload<T>(Block block) where T : BlockPayload =>
        block.Payload as T;

    private static IReadOnlyList<InlineSpan> GetImageCaptionSpans(Block block, string? alt)
    {
        block.EnsureSpans();
        if (block.Spans is { Count: > 0 } && block.Content.Trim().Length > 0)
            return block.Spans;
        if (!string.IsNullOrWhiteSpace(alt))
            return [InlineSpan.Plain(alt.Trim())];
        return Array.Empty<InlineSpan>();
    }

    private static string NormalizeAlign(string? align) =>
        string.Equals(align, "center", StringComparison.OrdinalIgnoreCase) ? "center"
        : string.Equals(align, "right", StringComparison.OrdinalIgnoreCase) ? "right"
        : "left";

    private static int ReadListNumberIndex(Block b)
    {
        if (!b.Meta.TryGetValue("listNumberIndex", out var v) || v == null)
            return 1;
        if (v is int i) return Math.Max(1, i);
        if (v is long l) return Math.Max(1, (int)l);
        if (v is JsonElement je && je.ValueKind == JsonValueKind.Number && je.TryGetInt32(out var n))
            return Math.Max(1, n);
        return int.TryParse(v.ToString(), out var p) ? Math.Max(1, p) : 1;
    }

    private static bool IsChecklistChecked(Block b)
    {
        if (MatchedPayload<ChecklistPayload>(b) is { } cp)
            return cp.Checked;
        if (b.Meta.TryGetValue("checked", out var v) && v != null)
        {
            if (v is bool bl) return bl;
            if (v is JsonElement je && je.ValueKind is JsonValueKind.True or JsonValueKind.False)
                return je.GetBoolean();
        }
        return false;
    }

    // Only well-known safe schemes become real links; anything else (javascript:, data:, file: ...)
    // renders as styled text with no link target. This keeps the export from carrying an unsafe URL,
    // mirroring the editor's link-mark href gate.
    private static bool IsSafeLinkUrl(string url)
    {
        var value = url.Trim();
        var colon = value.IndexOf(':');
        if (colon < 0)
            return false; // relative or scheme-less: not a navigable external link in a PDF
        var scheme = value[..colon].ToLowerInvariant();
        return scheme is "http" or "https" or "mailto" or "tel";
    }

    private static string? ResolveSwatchColor(IReadOnlyDictionary<string, string>? swatchHexByName, string? rawColor)
    {
        if (string.IsNullOrWhiteSpace(rawColor))
            return null;

        var token = rawColor.Trim();
        if (token.StartsWith("swatch", StringComparison.OrdinalIgnoreCase)
            && swatchHexByName != null
            && swatchHexByName.TryGetValue(token, out var mapped)
            && !string.IsNullOrWhiteSpace(mapped))
        {
            token = mapped.Trim();
        }

        if (!token.StartsWith('#') && token.Length == 6 && Regex.IsMatch(token, "^[0-9A-Fa-f]{6}$"))
            token = "#" + token;

        return Regex.IsMatch(token, "^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$") ? token : null;
    }

    // === Sketch PDF helpers ===

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

    private const float MaxSketchPdfWidthPt = 480f;

    internal static (float WidthPt, string Align) ResolveSketchPdfLayout(Block block)
    {
        if (MatchedPayload<SketchPayload>(block) is not { } payload)
            return (0, "left");

        var widthPt = payload.Width > 0
            ? (float)Math.Clamp(payload.Width * 0.75, 48, MaxSketchPdfWidthPt)
            : 0;
        return (widthPt, NormalizeAlign(payload.Align));
    }

    // === Formatting ===

    private static string Pt(double value) => Num(value) + "pt";

    private static string Num(double value) =>
        Math.Round(value, 3).ToString("0.###", CultureInfo.InvariantCulture);

    /// <summary>
    /// A dimensionless ratio, held finer than a point measurement needs to be.
    ///
    /// These are multiplied by a length before they become one, so three decimals here is not a
    /// thousandth of a point, it is a thousandth of the frame. A crop pinned to the source's right
    /// or bottom edge is where that shows: the placed image lands a hair short of the clip box and
    /// a sliver of background appears along the edge, which is precisely the crop nobody would
    /// suspect the formatter of.
    /// </summary>
    private static string Ratio(double value) =>
        Math.Round(value, 6).ToString("0.######", CultureInfo.InvariantCulture);
}
