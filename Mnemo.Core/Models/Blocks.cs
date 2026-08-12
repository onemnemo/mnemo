using System.Collections.Generic;
using System.Text.Json.Serialization;
using Mnemo.Core.Formatting;
using Mnemo.Core.Serialization;

namespace Mnemo.Core.Models;

public enum BlockType
{
    Text,
    Heading1,
    Heading2,
    Heading3,
    Heading4,
    BulletList,
    NumberedList,
    Checklist,
    Quote,
    Code,
    Divider,
    Image,
    ColumnGroup,
    TwoColumn,
    Equation,
    Page,
    Sketch,
    Callout
}

[JsonConverter(typeof(BlockJsonConverter))]
public class Block
{
    public string Id { get; set; } = Guid.NewGuid().ToString();

    /// <summary>
    /// Short identifier, unique within the owning note. This is the block id that crosses the model
    /// and tool boundary; <see cref="Id"/> stays internal. Empty until the sid migration has run
    /// over the owning note — a block minted in memory has no scope to be unique against yet, so
    /// whoever attaches it to a note assigns the sid.
    /// </summary>
    public string Sid { get; set; } = string.Empty;

    public BlockType Type { get; set; }

    /// <summary>Structured inline content (rich text blocks). Equation/code/image blocks may use <see cref="Payload"/> as primary.</summary>
    public List<InlineSpan> Spans { get; set; } = new();

    /// <summary>Typed data for non-flow blocks (equation, image, code, checklist) and layout (two-column split). Use <see cref="Meta"/> only for extensions.</summary>
    public BlockPayload Payload { get; set; } = new EmptyPayload();

    public Dictionary<string, object> Meta { get; set; } = new();
    public int Order { get; set; }
    public List<Block>? Children { get; set; }

    /// <summary>Human-visible plain text (equations as LaTeX, not atom chars). For markdown/export.</summary>
    [JsonIgnore]
    public string Content => InlineSpanText.FlattenDisplay(Spans);

    /// <summary>Ensures <see cref="Spans"/> is non-empty after load.</summary>
    public void EnsureSpans()
    {
        if (Spans is not { Count: > 0 })
            Spans = new List<InlineSpan> { InlineSpan.Plain(string.Empty) };
        Spans = InlineSpanFormatApplier.Normalize(Spans);
    }
}
