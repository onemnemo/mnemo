namespace Mnemo.Core.Models;

public abstract record BlockPayload;

public sealed record EmptyPayload : BlockPayload;

public sealed record EquationPayload(string Latex) : BlockPayload;

public sealed record ImagePayload(
    string Path = "",
    string Alt = "",
    double Width = 0,
    string Align = "left") : BlockPayload;

public sealed record CodePayload(string Language, string Source) : BlockPayload;

public sealed record ChecklistPayload(bool Checked) : BlockPayload;

/// <summary>Layout for <see cref="BlockType.TwoColumn"/> — split ratio is owned by the container, not column cells.</summary>
public sealed record TwoColumnPayload(double SplitRatio = 0.5) : BlockPayload;

/// <summary>Embedded sub-note for <see cref="BlockType.Page"/>; title is always read from the referenced note.</summary>
public sealed record PagePayload(string ReferenceNoteId) : BlockPayload;

/// <summary>Layout metadata for <see cref="BlockType.Sketch"/> — display width and alignment. Source DSL lives in the block's spans.</summary>
public sealed record SketchPayload(
    double Width = 0,
    string Align = "left") : BlockPayload;

/// <summary>Leading glyph and tone for <see cref="BlockType.Callout"/>; the body is inline content in the block's spans.</summary>
public sealed record CalloutPayload(
    string Emoji = "",
    string Tone = "note") : BlockPayload;
