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
    Callout,
    // Appended, never inserted: readers fall back to the ordinal when a type
    // arrives as a number, so the declaration order is part of the format.
    Table,
    TableRow,
    TableCell
}

[JsonConverter(typeof(BlockJsonConverter))]
public class Block
{
    private BlockType _type;
    private BlockPayload _payload = new EmptyPayload();

    public string Id { get; set; } = Guid.NewGuid().ToString();

    /// <summary>
    /// Short identifier, unique within the owning note. This is the block id the editor addresses
    /// blocks by across the wire; the agent tools address them by a prefix of <see cref="Id"/>
    /// instead. Empty until the sid migration has run over the owning note, since a block minted in
    /// memory has no scope to be unique against yet, so whoever attaches it to a note assigns it.
    /// </summary>
    public string Sid { get; set; } = string.Empty;

    public BlockType Type
    {
        get => _type;
        set
        {
            _type = value;
            // Whoever sets a type has decided what the block is, so a token an older read could
            // not understand must not be put back over that decision on the next write.
            UnknownType = null;
        }
    }

    /// <summary>Structured inline content (rich text blocks). Equation/code/image blocks may use <see cref="Payload"/> as primary.</summary>
    public List<InlineSpan> Spans { get; set; } = new();

    /// <summary>Typed data for non-flow blocks (equation, image, code, checklist) and layout (two-column split). Use <see cref="Meta"/> only for extensions.</summary>
    public BlockPayload Payload
    {
        get => _payload;
        set
        {
            _payload = value;
            UnknownPayloadJson = null;
        }
    }

    /// <summary>
    /// The stored type token when this build has no such block type, which happens to a note saved
    /// by a newer version. The block reads as text so the rest of the note still works, and the
    /// original token goes back to disk on the next write instead of the note being rewritten as
    /// plain text.
    /// </summary>
    public string? UnknownType { get; set; }

    /// <summary>
    /// The stored payload object, verbatim, when this build has no such payload kind. Kept for the
    /// same reason as <see cref="UnknownType"/>.
    /// </summary>
    public string? UnknownPayloadJson { get; set; }

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
