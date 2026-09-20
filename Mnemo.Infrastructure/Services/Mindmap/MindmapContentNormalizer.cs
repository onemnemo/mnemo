using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// The one rule that keeps a label's runs and its plain text from drifting apart.
/// <para>
/// A content that carries runs is written with its text recomputed from them, whatever the caller
/// sent, so every reader of <c>Text</c> (search, export, an older client) sees the words the runs
/// spell. A content with no runs is left alone. Runs that spell nothing and hold no atom are dropped,
/// so an emptied node goes back to being a plain one rather than carrying an empty run forever.
/// </para>
/// <para>
/// Applied at every point a content enters the document through an edit. The text shorthand goes the
/// other way and clears the runs itself, which is the other half of the same rule.
/// </para>
/// </summary>
internal static class MindmapContentNormalizer
{
    public static MindmapDocument NormalizeDocument(MindmapDocument document)
    {
        List<MindmapElement>? changed = null;
        for (var index = 0; index < document.Elements.Count; index++)
        {
            var element = document.Elements[index];
            var content = Normalize(element.Content);
            if (ReferenceEquals(content, element.Content))
                continue;

            changed ??= document.Elements.ToList();
            changed[index] = element with { Content = content };
        }

        return changed is null ? document : document with { Elements = changed };
    }

    /// <summary>Normalizes stored content and detaches malformed line attachments.</summary>
    public static MindmapDocument RepairLoadedDocument(MindmapDocument document)
    {
        var normalized = NormalizeDocument(document);
        var byId = new Dictionary<string, MindmapElement>(StringComparer.Ordinal);
        foreach (var element in normalized.Elements)
            byId.TryAdd(element.Id, element);
        List<MindmapElement>? changed = null;

        for (var index = 0; index < normalized.Elements.Count; index++)
        {
            var element = normalized.Elements[index];
            if (element.Content is not ShapeContent { Line: { } line } shape)
                continue;

            var start = IsUsableAttachment(line.StartAt, byId) ? line.StartAt : null;
            var end = IsUsableAttachment(line.EndAt, byId) ? line.EndAt : null;
            if (ReferenceEquals(start, line.StartAt) && ReferenceEquals(end, line.EndAt))
                continue;

            changed ??= normalized.Elements.ToList();
            changed[index] = element with
            {
                Content = shape with { Line = line with { StartAt = start, EndAt = end } },
            };
        }

        return changed is null ? normalized : normalized with { Elements = changed };
    }

    public static bool IsEligibleLineTarget(MindmapElement element) => element.Kind switch
    {
        ElementKind.Node => true,
        ElementKind.Shape when element.Content is ShapeContent shape =>
            shape.Shape is not ShapeType.Line and not ShapeType.Arrow,
        _ => false,
    };

    public static bool IsUsableAttachment(
        LineAttachment? attachment,
        IReadOnlyDictionary<string, MindmapElement> elements)
    {
        if (attachment is null)
            return true;
        if (string.IsNullOrWhiteSpace(attachment.ElementId) || !Enum.IsDefined(attachment.Side))
            return false;
        return elements.TryGetValue(attachment.ElementId, out var target) && IsEligibleLineTarget(target);
    }

    public static IElementContent Normalize(IElementContent content) => content switch
    {
        TextContent text when text.Runs is not null => Settle(text.Runs) is { } runs
            ? text with { Runs = runs, Text = InlineSpanText.FlattenDisplay(runs) }
            : text with { Runs = null, Text = string.Empty },
        TaskContent task when task.Runs is not null => Settle(task.Runs) is { } runs
            ? task with { Runs = runs, Text = InlineSpanText.FlattenDisplay(runs) }
            : task with { Runs = null, Text = string.Empty },
        ShapeContent shape => SettleShape(shape),
        FreeTextContent free when free.Runs is not null => Settle(free.Runs) is { } runs
            ? free with { Runs = runs, Text = InlineSpanText.FlattenDisplay(runs) }
            : free with { Runs = null, Text = string.Empty },
        _ => content,
    };

    /// <summary>The thinnest stroke that can still be seen and hit, and the heaviest that is still a line.</summary>
    private const double MinThickness = 0.5;
    private const double MaxThickness = 12;

    private static ShapeContent SettleShape(ShapeContent shape)
    {
        var settled = shape;
        if (shape.Runs is not null)
        {
            settled = Settle(shape.Runs) is { } runs
                ? settled with { Runs = runs, Text = InlineSpanText.FlattenDisplay(runs) }
                : settled with { Runs = null, Text = string.Empty };
        }

        var rotation = shape.Rotation % 360;
        if (rotation < 0)
            rotation += 360;
        if (double.IsNaN(rotation))
            rotation = 0;
        if (rotation != shape.Rotation)
            settled = settled with { Rotation = rotation };

        if (shape.Thickness is { } thickness)
        {
            var clamped = double.IsNaN(thickness) ? MinThickness : Math.Clamp(thickness, MinThickness, MaxThickness);
            if (clamped != thickness)
                settled = settled with { Thickness = clamped };
        }

        return settled;
    }

    /// <summary>The runs merged where adjacent styles agree, or null when they amount to nothing.</summary>
    private static IReadOnlyList<InlineSpan>? Settle(IReadOnlyList<InlineSpan> runs)
    {
        var merged = InlineSpanFormatApplier.Normalize(runs);
        var empty = merged.All(static run => run is TextSpan { Text.Length: 0 });
        return empty ? null : merged;
    }
}
