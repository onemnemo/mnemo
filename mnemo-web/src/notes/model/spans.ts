/**
 * Span-list operations: style comparison, normalization, and the two flattened
 * text projections the editor needs.
 */

import {
  defaultTextStyle,
  equationAtomChar,
  fractionAtomChar,
  isAtomSpan,
  type InlineSpan,
  type TextSpan,
  type TextStyle,
} from './types';

const styleKeys = Object.keys(defaultTextStyle) as (keyof TextStyle)[];

export function stylesEqual(a: TextStyle, b: TextStyle): boolean {
  return styleKeys.every((k) => a[k] === b[k]);
}

export function plainSpan(text: string, style: TextStyle = defaultTextStyle): TextSpan {
  return { kind: 'text', text, style };
}

/**
 * Merges adjacent text spans that share a style and drops empty ones, so a
 * given document has one canonical span list. Editing repeatedly splits spans
 * at style boundaries; without this the list grows without bound as the user
 * types across a mark.
 *
 * Always returns at least one span: an empty block is a single empty text span,
 * never a zero-length list, so there is always somewhere to put the caret.
 */
export function normalizeSpans(spans: readonly InlineSpan[]): InlineSpan[] {
  if (spans.length === 0) return [plainSpan('')];

  const result: InlineSpan[] = [];
  let current = spans[0];

  const flush = (span: InlineSpan) => {
    // Atoms survive being empty; an empty text span carries nothing.
    if (span.kind !== 'text' || span.text.length > 0) result.push(span);
  };

  for (let i = 1; i < spans.length; i++) {
    const next = spans[i];
    if (current.kind === 'text' && next.kind === 'text' && stylesEqual(current.style, next.style)) {
      current = { ...current, text: current.text + next.text };
    } else {
      flush(current);
      current = next;
    }
  }
  flush(current);

  return result.length > 0 ? result : [plainSpan('')];
}

/**
 * Human-readable text: equations render as their LaTeX source and fractions as
 * `n/d`. For markdown export, search indexing and accessibility, never for
 * caret arithmetic, since an atom's display width is not its caret width.
 */
export function flattenDisplay(spans: readonly InlineSpan[]): string {
  let out = '';
  for (const span of spans) {
    if (span.kind === 'text') out += span.text;
    else if (span.kind === 'equation') out += span.latex;
    else out += `${span.numerator}/${span.denominator}`;
  }
  return out;
}

/**
 * Caret-space text: every atom collapses to a single placeholder character, so
 * a string offset into this projection maps 1:1 onto a caret position. This is
 * the string to diff against and to measure selections in.
 */
export function flattenForCaret(spans: readonly InlineSpan[]): string {
  let out = '';
  for (const span of spans) {
    if (span.kind === 'text') out += span.text;
    else if (span.kind === 'equation') out += equationAtomChar;
    else out += fractionAtomChar;
  }
  return out;
}

/** Total caret positions spanned, i.e. the length of the caret-space projection. */
export function caretLength(spans: readonly InlineSpan[]): number {
  let total = 0;
  for (const span of spans) total += spanCaretLength(span);
  return total;
}

/** Caret width of a single span: 1 for an atom, its text length otherwise. */
export function spanCaretLength(span: InlineSpan): number {
  return isAtomSpan(span) ? 1 : span.text.length;
}
