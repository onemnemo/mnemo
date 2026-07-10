using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Renders a <see cref="MindmapDocument"/> as a plain Markdown outline: the title as an H1, each hierarchy
/// tree as a nested bullet list, free elements and frames under trailing sections, and link edges as
/// footnotes. Pure and deterministic — a given document always produces the same text. Collapse state and
/// styling are ignored (the whole map is exported). It doubles as a flat export and an AI-cheap "read the
/// whole map as text" path.
/// </summary>
/// <remarks>
/// Reference nodes (note/flashcard) render their target id plus a marker, because a title resolves lazily
/// against the referenced entity and is not present in the document; a pure projection cannot look it up.
/// Child ordering follows hierarchy-edge order and roots follow element order, matching the tool outline
/// projection so the two agree.
/// </remarks>
public static class MindmapMarkdownExporter
{
    // Section headings are fixed English: this lives in Core, which has no localization, and the output is a
    // plain-text export artifact (comparable to the verbatim adapter display names).
    private const string FreeElementsHeading = "Canvas elements";
    private const string UntitledFrameHeading = "Frame";

    public static string ExportOutline(MindmapDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        var byId = new Dictionary<string, MindmapElement>(StringComparer.Ordinal);
        foreach (var element in document.Elements)
            byId[element.Id] = element;

        var childrenOf = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var hasParent = new HashSet<string>(StringComparer.Ordinal);
        foreach (var edge in document.Edges)
        {
            if (edge.Kind != EdgeKind.Hierarchy)
                continue;
            if (!byId.ContainsKey(edge.FromId) || !byId.ContainsKey(edge.ToId))
                continue;
            if (!childrenOf.TryGetValue(edge.FromId, out var list))
                childrenOf[edge.FromId] = list = new List<string>();
            list.Add(edge.ToId);
            hasParent.Add(edge.ToId);
        }

        // Link edges become numbered footnotes, numbered in document edge order over edges whose endpoints
        // both exist, so every reference marker has a matching definition and vice versa.
        var markersByElement = new Dictionary<string, List<int>>(StringComparer.Ordinal);
        var footnotes = new List<(int Number, string TargetId, string? Label)>();
        var next = 0;
        foreach (var edge in document.Edges)
        {
            if (edge.Kind != EdgeKind.Link)
                continue;
            if (!byId.ContainsKey(edge.FromId) || !byId.ContainsKey(edge.ToId))
                continue;
            next++;
            if (!markersByElement.TryGetValue(edge.FromId, out var markers))
                markersByElement[edge.FromId] = markers = new List<int>();
            markers.Add(next);
            footnotes.Add((next, edge.ToId, string.IsNullOrWhiteSpace(edge.Label) ? null : edge.Label));
        }

        var blocks = new List<string> { "# " + SingleLine(document.Title) };

        // Trees: roots are nodes with no hierarchy parent, in element order.
        var treeLines = new List<string>();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        foreach (var element in document.Elements)
        {
            if (element.Kind != ElementKind.Node || hasParent.Contains(element.Id))
                continue;
            WriteNode(treeLines, element.Id, 0, byId, childrenOf, markersByElement, visited);
        }
        if (treeLines.Count > 0)
            blocks.Add(string.Join("\n", treeLines));

        // Free elements (shapes, free text, images) in one trailing section. Empty-text elements are skipped
        // unless they are a link source, so their footnote marker keeps a home.
        var freeLines = new List<string>();
        foreach (var element in document.Elements)
        {
            if (element.Kind is ElementKind.Node or ElementKind.Frame)
                continue;
            var inline = InlineContent(element);
            var hasMarker = markersByElement.ContainsKey(element.Id);
            if (string.IsNullOrWhiteSpace(inline) && !hasMarker)
                continue;
            freeLines.Add(("- " + inline + Markers(markersByElement, element.Id)).TrimEnd());
        }
        if (freeLines.Count > 0)
            blocks.Add("## " + FreeElementsHeading + "\n" + string.Join("\n", freeLines));

        // Frames: each is its own grouping listing members by a short label, in element order.
        foreach (var element in document.Elements)
        {
            if (element.Content is not FrameContent frame)
                continue;
            var members = frame.ChildIds.Where(byId.ContainsKey).ToList();
            var title = SingleLine(frame.Title);
            if (title.Length == 0 && members.Count == 0)
                continue;
            var lines = new List<string> { "### " + (title.Length == 0 ? UntitledFrameHeading : title) };
            foreach (var memberId in members)
                lines.Add("- " + ShortLabel(byId[memberId]));
            blocks.Add(string.Join("\n", lines));
        }

        if (footnotes.Count > 0)
        {
            var lines = new List<string>(footnotes.Count);
            foreach (var (number, targetId, label) in footnotes)
            {
                var target = byId.TryGetValue(targetId, out var element) ? ShortLabel(element) : targetId;
                var line = "[^" + number.ToString(CultureInfo.InvariantCulture) + "]: → " + target;
                if (label is not null)
                    line += " (" + SingleLine(label) + ")";
                lines.Add(line);
            }
            blocks.Add(string.Join("\n", lines));
        }

        return string.Join("\n\n", blocks);
    }

    private static void WriteNode(
        List<string> lines,
        string id,
        int depth,
        IReadOnlyDictionary<string, MindmapElement> byId,
        IReadOnlyDictionary<string, List<string>> childrenOf,
        IReadOnlyDictionary<string, List<int>> markersByElement,
        HashSet<string> visited)
    {
        if (!visited.Add(id))
            return; // guards a malformed hierarchy cycle
        if (!byId.TryGetValue(id, out var element))
            return;

        var indent = new string(' ', depth * 2);
        var markers = Markers(markersByElement, id);

        if (element.Content is CodeContent code)
        {
            var source = SplitSourceLines(code.Source);
            var first = source.Count > 0 ? source[0] : string.Empty;
            lines.Add((indent + "- `" + first + "`" + markers).TrimEnd());
            if (source.Count > 1)
            {
                var fence = indent + "  ";
                lines.Add(fence + "```" + SingleLine(code.Language).Replace(" ", string.Empty));
                foreach (var line in source)
                    lines.Add(fence + line);
                lines.Add(fence + "```");
            }
        }
        else
        {
            lines.Add((indent + "- " + InlineContent(element) + markers).TrimEnd());
        }

        if (childrenOf.TryGetValue(id, out var children))
            foreach (var child in children)
                WriteNode(lines, child, depth + 1, byId, childrenOf, markersByElement, visited);
    }

    // The Markdown rendering of an element's content, for a primary list line.
    private static string InlineContent(MindmapElement element) => element.Content switch
    {
        TextContent text => SingleLine(text.Text),
        TaskContent task => "[" + (task.Done ? "x" : " ") + "]" + Suffix(SingleLine(task.Text)),
        CodeContent code => "`" + SingleLine(FirstLine(code.Source)) + "`",
        MathContent math => "$" + SingleLine(math.Latex) + "$",
        LinkContent link => "[" + SingleLine(LinkText(link)) + "](" + SingleLine(link.Url) + ")",
        ImageContent image => "![" + SingleLine(image.Caption ?? string.Empty) + "](" + SingleLine(image.AssetId) + ")",
        FlashcardContent card => SingleLine(card.DeckId) + " (deck)",
        NoteContent note => SingleLine(note.NoteId) + " (note)",
        ShapeContent shape => SingleLine(shape.Text ?? string.Empty),
        FreeTextContent free => SingleLine(free.Text),
        CanvasImageContent image => "![](" + SingleLine(image.AssetId) + ")",
        FrameContent frame => SingleLine(frame.Title),
        _ => string.Empty,
    };

    // A plain single-line label (no Markdown decoration) for footnote targets and frame members; falls back
    // to the element id so a label is never blank.
    private static string ShortLabel(MindmapElement element)
    {
        var label = element.Content switch
        {
            TextContent text => SingleLine(text.Text),
            TaskContent task => SingleLine(task.Text),
            CodeContent code => SingleLine(FirstLine(code.Source)),
            MathContent math => SingleLine(math.Latex),
            LinkContent link => SingleLine(LinkText(link)),
            ImageContent image => SingleLine(string.IsNullOrEmpty(image.Caption) ? image.AssetId : image.Caption!),
            FlashcardContent card => SingleLine(card.DeckId) + " (deck)",
            NoteContent note => SingleLine(note.NoteId) + " (note)",
            ShapeContent shape => SingleLine(shape.Text ?? string.Empty),
            FreeTextContent free => SingleLine(free.Text),
            CanvasImageContent image => SingleLine(image.AssetId),
            FrameContent frame => SingleLine(frame.Title),
            _ => string.Empty,
        };
        return label.Length == 0 ? element.Id : label;
    }

    private static string Markers(IReadOnlyDictionary<string, List<int>> markersByElement, string id)
    {
        if (!markersByElement.TryGetValue(id, out var markers) || markers.Count == 0)
            return string.Empty;

        var sb = new StringBuilder();
        foreach (var marker in markers)
            sb.Append("[^").Append(marker.ToString(CultureInfo.InvariantCulture)).Append(']');
        return sb.ToString();
    }

    private static string LinkText(LinkContent link) =>
        string.IsNullOrWhiteSpace(link.Title) ? link.Url : link.Title!;

    private static string Suffix(string text) => text.Length == 0 ? string.Empty : " " + text;

    private static string FirstLine(string value)
    {
        var newline = value.IndexOfAny(['\n', '\r']);
        return newline < 0 ? value : value[..newline];
    }

    private static List<string> SplitSourceLines(string source)
    {
        var normalized = source.Replace("\r\n", "\n").Replace('\r', '\n');
        var lines = normalized.Split('\n').ToList();
        while (lines.Count > 1 && lines[^1].Length == 0)
            lines.RemoveAt(lines.Count - 1);
        return lines;
    }

    // Collapses a value to a single line so it never breaks list/footnote structure.
    private static string SingleLine(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;
        return value.Replace("\r\n", " ").Replace('\n', ' ').Replace('\r', ' ').Trim();
    }
}
