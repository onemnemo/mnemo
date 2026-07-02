using System;
using System.Collections.Generic;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Tools.Notes;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Services.Notes;

/// <summary>Builds <see cref="Block"/> instances from the agent-facing <see cref="NoteBlockSpec"/>.</summary>
internal static class NoteToolBlockFactory
{
    /// <summary>Builds a block (with any nested children) from the agent-facing <see cref="NoteBlockSpec"/>.</summary>
    public static Block FromSpec(NoteBlockSpec spec, int order)
    {
        if (!Enum.TryParse<BlockType>(spec.Type, true, out var type))
            type = BlockType.Text;

        var b = new Block { Id = Guid.NewGuid().ToString(), Type = type, Order = order };

        switch (type)
        {
            case BlockType.Divider:
                break;
            case BlockType.Equation:
                b.Payload = new EquationPayload((spec.Latex ?? spec.Markdown ?? string.Empty).Trim());
                b.Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };
                break;
            case BlockType.Code:
                var source = spec.Markdown ?? string.Empty;
                b.Payload = new CodePayload(string.IsNullOrWhiteSpace(spec.Language) ? "csharp" : spec.Language!.Trim(), source);
                b.Spans = new List<InlineSpan> { InlineSpan.Plain(source) };
                break;
            case BlockType.Page:
                b.Payload = new PagePayload((spec.Markdown ?? string.Empty).Trim());
                b.Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };
                break;
            default:
                b.Spans = InlineMarkdownParser.ToSpans(spec.Markdown ?? string.Empty);
                if (type is BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4)
                    EnsureHeadingBold(b);
                if (type == BlockType.Checklist)
                    b.Payload = new ChecklistPayload(spec.Checked ?? false);
                break;
        }

        if (spec.Children is { Count: > 0 })
        {
            b.Children = new List<Block>(spec.Children.Count);
            for (var i = 0; i < spec.Children.Count; i++)
                b.Children.Add(FromSpec(spec.Children[i], i));
        }

        return b;
    }

    /// <summary>Builds an ordered block list from specs, numbering from <paramref name="startOrder"/>.</summary>
    public static List<Block> FromSpecs(IReadOnlyList<NoteBlockSpec> specs, int startOrder = 0)
    {
        var list = new List<Block>(specs.Count);
        for (var i = 0; i < specs.Count; i++)
            list.Add(FromSpec(specs[i], startOrder + i));
        return list;
    }

    private static void EnsureHeadingBold(Block b)
    {
        b.EnsureSpans();
        var list = new List<InlineSpan>();
        foreach (var s in b.Spans)
        {
            if (s is TextSpan t)
                list.Add(t with { Style = t.Style.WithSet(InlineFormatKind.Bold) });
            else
                list.Add(s);
        }

        b.Spans = InlineSpanFormatApplier.Normalize(list);
    }
}







