/**
 * The note document model, mirroring Mnemo.Core's Block/InlineSpan types.
 *
 * These shapes are the durable wire format shared with the .NET side, so they
 * are structural, not clever: no class hierarchy, no methods, discriminated
 * unions keyed on `kind` exactly as the JSON converter writes them.
 */

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
  | 'Sketch';

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

/** Inline LaTeX. Atomic for caret and selection — it occupies one position, not `latex.length`. */
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
  | { kind: 'image'; path: string; alt: string; width: number; align: string }
  | { kind: 'code'; language: string; source: string }
  | { kind: 'checklist'; checked: boolean }
  /** Split ratio belongs to the container, not to the column cells. */
  | { kind: 'twoColumn'; splitRatio: number }
  /** Embedded sub-note; the title is always read from the referenced note, never copied. */
  | { kind: 'page'; referenceNoteId: string }
  | { kind: 'sketch'; width: number; align: string };

export interface Block {
  id: string;
  type: BlockType;
  /** Rich inline content. Equation/code/image blocks carry their data in `payload` instead. */
  spans: InlineSpan[];
  payload: BlockPayload;
  /** Extension point only — anything with a defined meaning belongs in `payload`. */
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
