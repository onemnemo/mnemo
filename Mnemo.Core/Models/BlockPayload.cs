namespace Mnemo.Core.Models;

public abstract record BlockPayload;

public sealed record EmptyPayload : BlockPayload;

public sealed record EquationPayload(string Latex) : BlockPayload;

public sealed record ImagePayload(
    string Path = "",
    string Alt = "",
    double Width = 0,
    string Align = "left") : BlockPayload;

/// <summary>
/// Source for <see cref="BlockType.Code"/>, plus how it is displayed. Wrap, line numbers and the
/// caption are choices the reader made about this snippet, so they belong to the block and a note
/// reopens looking the way it was left.
/// </summary>
public sealed record CodePayload(
    string Language,
    string Source,
    bool Wrap = false,
    bool Numbers = false,
    string Caption = "") : BlockPayload;

public sealed record ChecklistPayload(bool Checked) : BlockPayload;

/// <summary>Layout for <see cref="BlockType.TwoColumn"/> — split ratio is owned by the container, not column cells.</summary>
public sealed record TwoColumnPayload(double SplitRatio = 0.5) : BlockPayload;

/// <summary>Embedded sub-note for <see cref="BlockType.Page"/>; title is always read from the referenced note.</summary>
public sealed record PagePayload(string ReferenceNoteId) : BlockPayload;

/// <summary>Layout metadata for <see cref="BlockType.Sketch"/> — display width and alignment. Source DSL lives in the block's spans.</summary>
public sealed record SketchPayload(
    double Width = 0,
    string Align = "left") : BlockPayload;

/// <summary>
/// What belongs to a <see cref="BlockType.Table"/> as a whole. The cells are the rows' children and
/// carry their own text, so the only structure here is the part no single cell owns.
///
/// Column widths live on the table rather than on each cell because a column has one width by
/// definition: storing it per cell makes a table whose rows disagree about it representable, and
/// then every reader has to decide which row wins.
/// </summary>
/// <summary>
/// A table's own structure. <see cref="HeaderRows"/> and <see cref="HeaderColumns"/> are aligned
/// to the row and column counts: entry <c>i</c> says whether row (or column) <c>i</c> is a header.
/// A flag per row and per column, not one "the first is a header" toggle, because any row or column
/// can be marked. The two booleans this replaced mapped onto the first row and column; a reader
/// takes a legacy note's <c>headerRow</c> / <c>headerCol</c> into position 0 of each array.
/// </summary>
public sealed record TablePayload(
    IReadOnlyList<double> ColumnWidths,
    IReadOnlyList<bool> HeaderRows,
    IReadOnlyList<bool> HeaderColumns,
    bool FullWidth = false) : BlockPayload;

/// <summary>Fill for <see cref="BlockType.TableCell"/>: one of the named tints, or empty for none.</summary>
public sealed record TableCellPayload(string Fill = "") : BlockPayload;

/// <summary>Leading glyph and tone for <see cref="BlockType.Callout"/>; the body is inline content in the block's spans.</summary>
public sealed record CalloutPayload(
    string Emoji = "",
    string Tone = "note") : BlockPayload;
