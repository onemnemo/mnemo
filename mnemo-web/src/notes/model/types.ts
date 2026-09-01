/**
 * The note document model, mirroring Mnemo.Core's Block/InlineSpan types.
 *
 * These shapes are the durable wire format shared with the .NET side, so they
 * are structural, not clever: no class hierarchy, no methods, discriminated
 * unions keyed on `kind` exactly as the JSON converter writes them.
 */

import type { ImageCrop } from '../../components/ui/image-editor/geometry';

export type BlockType =
  | 'Text'
  | 'Heading1'
  | 'Heading2'
  | 'Heading3'
  | 'Heading4'
  | 'BulletList'
  | 'NumberedList'
  | 'Checklist'
  | 'Quote'
  | 'Code'
  | 'Divider'
  | 'Image'
  | 'ColumnGroup'
  | 'TwoColumn'
  | 'Equation'
  | 'Page'
  | 'Sketch'
  | 'Callout'
  | 'Table'
  | 'TableRow'
  | 'TableCell';

/**
 * Every block type, in the C# enum's declaration order, the ordinal fallback
 * in `wire.ts` depends on that order.
 *
 * Built from an exhaustive record so adding another `BlockType` without listing
 * it here is a compile error. A plain array would type-check while silently
 * shrinking every completeness check that walks it.
 */
const blockTypeMembers = {
  Text: true, Heading1: true, Heading2: true, Heading3: true, Heading4: true,
  BulletList: true, NumberedList: true, Checklist: true, Quote: true,
  Code: true, Divider: true, Image: true, ColumnGroup: true, TwoColumn: true,
  Equation: true, Page: true, Sketch: true, Callout: true,
  Table: true, TableRow: true, TableCell: true,
} satisfies Record<BlockType, true>;

export const allBlockTypes = Object.keys(blockTypeMembers) as readonly BlockType[];

/** Text-only annotations. Inline equations are their own span kind, never a style flag. */
export interface TextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  highlight: boolean;
  backgroundColor: string | null;
  foregroundColor: string | null;
  linkUrl: string | null;
  suppressAutoLink: boolean;
  subscript: boolean;
  superscript: boolean;
}

export const defaultTextStyle: Readonly<TextStyle> = Object.freeze({
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  highlight: false,
  backgroundColor: null,
  foregroundColor: null,
  linkUrl: null,
  suppressAutoLink: false,
  subscript: false,
  superscript: false,
});

export interface TextSpan {
  kind: 'text';
  text: string;
  style: TextStyle;
}

/** Inline LaTeX. Atomic for caret and selection, it occupies one position, not `latex.length`. */
export interface EquationSpan {
  kind: 'equation';
  latex: string;
  style: TextStyle;
}

/** Inline fraction atom, likewise one caret position wide. */
export interface FractionSpan {
  kind: 'fraction';
  numerator: number;
  denominator: number;
  style: TextStyle;
}

export type InlineSpan = TextSpan | EquationSpan | FractionSpan;

/**
 * Placeholder characters used only in transient flattened strings for caret
 * arithmetic and diffing. They are never stored in a TextSpan's text.
 */
export const equationAtomChar = '￼';
export const fractionAtomChar = '￹';

export type BlockPayload =
  | { kind: 'empty' }
  | { kind: 'equation'; latex: string }
  /**
   * `crop` is required and nullable rather than optional: an image is one of the
   * few payloads built in code as well as read off the wire, and an optional field
   * lets a construction site forget it, which reads as "no crop" and quietly
   * discards one the user had made.
   */
  | { kind: 'image'; path: string; alt: string; width: number; align: string; crop: ImageCrop | null }
  /**
   * `wrap`, `numbers` and `caption` are the reader's display choices for this
   * snippet. Optional because the writer omits them at their defaults, so every
   * code block stored before they existed still round-trips to its own bytes.
   */
  | {
      kind: 'code';
      language: string;
      source: string;
      wrap?: boolean;
      numbers?: boolean;
      caption?: string;
    }
  | { kind: 'checklist'; checked: boolean }
  /** Split ratio belongs to the container, not to the column cells. */
  | { kind: 'twoColumn'; splitRatio: number }
  /** Embedded sub-note; the title is always read from the referenced note, never copied. */
  | { kind: 'page'; referenceNoteId: string }
  | { kind: 'sketch'; width: number; align: string }
  /** Leading glyph and tone for a callout; its body is inline content in `spans`. */
  | { kind: 'callout'; emoji: string; tone: string }
  /**
   * What belongs to a table as a whole. Cells are the rows' children and carry
   * their own text, so the only structure here is the part no single cell owns.
   * A column has one width by definition, which is why the widths sit here and
   * not on the cells.
   *
   * `headerRows` and `headerColumns` are aligned to the row and column counts:
   * entry `i` says whether row (or column) `i` is a header. A per-axis flag, not
   * a single "the first one is a header" toggle, because any row or column can be
   * marked, and two of them can disagree. The two legacy booleans this replaces
   * mapped onto the first row and the first column, and load reconciles them into
   * position 0 of each array.
   */
  | {
      kind: 'table';
      columnWidths: number[];
      headerRows: boolean[];
      headerColumns: boolean[];
      fullWidth: boolean;
    }
  /** One of the named tints, or empty for no fill. */
  | { kind: 'tableCell'; fill: string };

export interface Block {
  id: string;
  /**
   * Short id, unique within the note. Empty means "not yet assigned", the
   * server mints one on commit, and only the server may, because minting is
   * check-and-retry against the ids already in scope.
   *
   * `id` stays the durable storage key; `sid` is the only identifier that
   * crosses the model boundary to the AI surface, so it must survive every
   * round trip. Dropping it on parse or on write reads to the server as a brand
   * new block and re-mints an id the user has already seen in chat history.
   */
  sid: string;
  type: BlockType;
  /** Rich inline content. Equation/code/image blocks carry their data in `payload` instead. */
  spans: InlineSpan[];
  payload: BlockPayload;
  /** Extension point only, anything with a defined meaning belongs in `payload`. */
  meta: Record<string, unknown>;
  order: number;
  children: Block[] | null;
}

export function isTextSpan(span: InlineSpan): span is TextSpan {
  return span.kind === 'text';
}

/** True for spans that occupy exactly one caret position regardless of their content. */
export function isAtomSpan(span: InlineSpan): span is EquationSpan | FractionSpan {
  return span.kind === 'equation' || span.kind === 'fraction';
}
