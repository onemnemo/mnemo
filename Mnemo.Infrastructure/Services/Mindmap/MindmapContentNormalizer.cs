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
    public static IElementContent Normalize(IElementContent content) => content switch
    {
        TextContent text when text.Runs is not null => Settle(text.Runs) is { } runs
            ? text with { Runs = runs, Text = InlineSpanText.FlattenDisplay(runs) }
            : text with { Runs = null, Text = string.Empty },
        TaskContent task when task.Runs is not null => Settle(task.Runs) is { } runs
            ? task with { Runs = runs, Text = InlineSpanText.FlattenDisplay(runs) }
            : task with { Runs = null, Text = string.Empty },
        ShapeContent shape when shape.Runs is not null => Settle(shape.Runs) is { } runs
            ? shape with { Runs = runs, Text = InlineSpanText.FlattenDisplay(runs) }
            : shape with { Runs = null, Text = string.Empty },
        FreeTextContent free when free.Runs is not null => Settle(free.Runs) is { } runs
            ? free with { Runs = runs, Text = InlineSpanText.FlattenDisplay(runs) }
            : free with { Runs = null, Text = string.Empty },
        _ => content,
    };

    /// <summary>The runs merged where adjacent styles agree, or null when they amount to nothing.</summary>
    private static IReadOnlyList<InlineSpan>? Settle(IReadOnlyList<InlineSpan> runs)
    {
        var merged = InlineSpanFormatApplier.Normalize(runs);
        var empty = merged.All(static run => run is TextSpan { Text.Length: 0 });
        return empty ? null : merged;
    }
}
