/**
 * Inline formatting: TextStyle mark operations and the span-list algorithms
 * that apply them over a caret range. This is the pure layer editor commands
 * and the formatting toolbar sit on top of, no DOM, no selection objects.
 */

import { caretLength, flattenDisplay, normalizeSpans, plainSpan, spanCaretLength } from './spans';
import { defaultTextStyle, isTextSpan, type InlineSpan, type TextStyle } from './types';

/**
 * Mirrors Mnemo.Core's InlineFormatKind enum member-for-member:
 * bold, italic, underline, strike=Strikethrough, highlight,
 * bg=BackgroundColor, fg=ForegroundColor, code, sub=Subscript,
 * sup=Superscript, link, equation.
 */
export type InlineFormat =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'highlight'
  | 'bg'
  | 'fg'
  | 'code'
  | 'sub'
  | 'sup'
  | 'link'
  | 'equation';

export function hasFormat(style: TextStyle, kind: InlineFormat): boolean {
  switch (kind) {
    case 'bold': return style.bold;
    case 'italic': return style.italic;
    case 'underline': return style.underline;
    case 'strike': return style.strikethrough;
    case 'highlight': return style.highlight;
    case 'bg': return style.backgroundColor != null;
    case 'fg': return style.foregroundColor != null;
    case 'code': return style.code;
    case 'sub': return style.subscript;
    case 'sup': return style.superscript;
    case 'link': return style.linkUrl != null;
    // Equation is a span kind, never a style flag.
    case 'equation': return false;
  }
}

export function setFormat(style: TextStyle, kind: InlineFormat, color?: string | null): TextStyle {
  const c = color ?? null;
  switch (kind) {
    case 'bold': return { ...style, bold: true };
    case 'italic': return { ...style, italic: true };
    case 'underline': return { ...style, underline: true };
    case 'strike': return { ...style, strikethrough: true };
    case 'code': return { ...style, code: true };
    case 'highlight': return { ...style, highlight: true };
    case 'bg': return { ...style, backgroundColor: c };
    case 'fg': return { ...style, foregroundColor: c };
    // Setting a link always clears the "don't autolink this" flag, so a
    // manually-applied link behaves like any other link on the next pass.
    case 'link': return { ...style, linkUrl: c, suppressAutoLink: false };
    case 'sub': return { ...style, subscript: true, superscript: false };
    case 'sup': return { ...style, superscript: true, subscript: false };
    case 'equation': return style;
  }
}

export function clearFormat(style: TextStyle, kind: InlineFormat): TextStyle {
  switch (kind) {
    case 'bold': return { ...style, bold: false };
    case 'italic': return { ...style, italic: false };
    case 'underline': return { ...style, underline: false };
    case 'strike': return { ...style, strikethrough: false };
    case 'code': return { ...style, code: false };
    case 'highlight': return { ...style, highlight: false };
    case 'bg': return { ...style, backgroundColor: null };
    case 'fg': return { ...style, foregroundColor: null };
    case 'link':
      // Clearing a link also blocks autolink from immediately reattaching
      // the same URL on the very next detection pass.
      return style.linkUrl != null ? { ...style, linkUrl: null, suppressAutoLink: true } : style;
    case 'sub': return { ...style, subscript: false };
    case 'sup': return { ...style, superscript: false };
    case 'equation': return style;
  }
}

export function toggleFormat(style: TextStyle, kind: InlineFormat, color?: string | null): TextStyle {
  const c = color ?? null;
  switch (kind) {
    case 'bold': return { ...style, bold: !style.bold };
    case 'italic': return { ...style, italic: !style.italic };
    case 'underline': return { ...style, underline: !style.underline };
    case 'strike': return { ...style, strikethrough: !style.strikethrough };
    case 'code': return { ...style, code: !style.code };
    case 'highlight': return { ...style, highlight: !style.highlight };
    case 'bg': return { ...style, backgroundColor: style.backgroundColor === c ? null : c };
    case 'fg': return { ...style, foregroundColor: style.foregroundColor === c ? null : c };
    case 'link':
      // Toggle only ever clears an existing link; turning one "on" always
      // goes through setFormat with an explicit URL (link dialog, paste,
      // applyFormat), never through toggle.
      return style.linkUrl != null ? { ...style, linkUrl: null, suppressAutoLink: true } : style;
    // The cleared side only zeroes out when the flag being toggled is turning
    // ON; toggling one OFF leaves the other exactly as it was. (Both can be
    // true going in, clearFormat, the fixture, or hand-built styles can all
    // produce that state, so "was the other one already off" is not a safe
    // shortcut here.)
    case 'sub': return { ...style, subscript: !style.subscript, superscript: style.subscript ? style.superscript : false };
    case 'sup': return { ...style, superscript: !style.superscript, subscript: style.superscript ? style.subscript : false };
    case 'equation': return style;
  }
}

/** Same span kind, replaced style. */
export function withStyle(span: InlineSpan, style: TextStyle): InlineSpan {
  return { ...span, style };
}

/**
 * Extracts the spans covering [start, end), clamped to the document. An atom
 * has no interior caret positions, so it is never partially covered: any
 * overlap with a clamped range means the range fully contains it (all caret
 * offsets are integers, and an atom is exactly one caret unit wide).
 */
export function sliceSpans(spans: readonly InlineSpan[], start: number, end: number): InlineSpan[] {
  if (spans.length === 0 || start >= end) return [];

  const total = caretLength(spans);
  const clampedStart = Math.min(Math.max(start, 0), total);
  const clampedEnd = Math.min(Math.max(end, 0), total);
  if (clampedStart >= clampedEnd) return [];

  const result: InlineSpan[] = [];
  let offset = 0;
  for (const span of spans) {
    const runEnd = offset + spanCaretLength(span);
    const segStart = Math.max(clampedStart, offset);
    const segEnd = Math.min(clampedEnd, runEnd);
    if (segStart < segEnd) {
      if (isTextSpan(span)) {
        result.push(plainSpan(span.text.slice(segStart - offset, segEnd - offset), span.style));
      } else {
        // Coverage of an atom is all-or-nothing by construction, so any
        // overlap here is full coverage, push it through whole.
        result.push(span);
      }
    }
    offset = runEnd;
  }

  return normalizeSpans(result);
}

/**
 * Carves text spans at the start/end boundaries wherever they fall strictly
 * inside a span, without clipping the document to [start, end), every span
 * outside the range still comes back untouched. Atoms always pass through
 * whole; this is purely about creating clean style-application edges inside
 * text runs.
 */
export function splitAt(spans: readonly InlineSpan[], start: number, end: number): InlineSpan[] {
  const result: InlineSpan[] = [];
  let offset = 0;

  for (const span of spans) {
    const runEnd = offset + spanCaretLength(span);
    const splitStart = start - offset;
    const splitEnd = end - offset;

    if (isTextSpan(span)) {
      const text = span.text;
      if (splitStart > 0 && splitStart < text.length && splitEnd > 0) {
        result.push(plainSpan(text.slice(0, splitStart), span.style));
        if (splitEnd > splitStart && splitEnd < text.length) {
          result.push(plainSpan(text.slice(splitStart, splitEnd), span.style));
          result.push(plainSpan(text.slice(splitEnd), span.style));
        } else {
          result.push(plainSpan(text.slice(splitStart), span.style));
        }
      } else if (splitEnd > 0 && splitEnd < text.length && splitStart <= 0) {
        result.push(plainSpan(text.slice(0, splitEnd), span.style));
        result.push(plainSpan(text.slice(splitEnd), span.style));
      } else {
        result.push(span);
      }
    } else {
      result.push(span);
    }

    offset = runEnd;
  }

  return result;
}

/**
 * True only if every span overlapping [start, end) already carries the mark.
 * `bg`/`fg` compare the color string exactly, so "everyone has *some*
 * background" does not count as having *this* background.
 */
export function rangeHasFormat(
  spans: readonly InlineSpan[],
  start: number,
  end: number,
  kind: InlineFormat,
  color?: string | null,
): boolean {
  const c = color ?? null;
  let offset = 0;
  for (const span of spans) {
    const runEnd = offset + spanCaretLength(span);
    if (offset < end && runEnd > start) {
      if (kind === 'bg') {
        if (span.style.backgroundColor !== c) return false;
      } else if (kind === 'fg') {
        if (span.style.foregroundColor !== c) return false;
      } else if (!hasFormat(span.style, kind)) {
        return false;
      }
    }
    offset = runEnd;
  }
  return true;
}

export function replaceRange(
  spans: readonly InlineSpan[],
  start: number,
  end: number,
  insertion: readonly InlineSpan[],
): InlineSpan[] {
  const total = caretLength(spans);
  let s = Math.min(Math.max(start, 0), total);
  let e = Math.min(Math.max(end, 0), total);
  if (s > e) [s, e] = [e, s];

  const head = sliceSpans(spans, 0, s);
  const tail = sliceSpans(spans, e, total);
  return normalizeSpans([...head, ...insertion, ...tail]);
}

/**
 * Unconditionally overwrites the subscript/superscript flags on every span
 * overlapping [start, end), no toggle, no all/any check. Used to make newly
 * typed characters obey a sticky sub/sup typing mode regardless of what was
 * selected beforehand.
 */
export function forceSubSup(
  spans: readonly InlineSpan[],
  start: number,
  end: number,
  sub: boolean,
  sup: boolean,
): InlineSpan[] {
  if (spans.length === 0 || start >= end) return [...spans];

  const split = splitAt(spans, start, end);
  const result: InlineSpan[] = [];
  let offset = 0;
  for (const span of split) {
    const runEnd = offset + spanCaretLength(span);
    if (offset < end && runEnd > start) {
      result.push(withStyle(span, { ...span.style, subscript: sub, superscript: sup }));
    } else {
      result.push(span);
    }
    offset = runEnd;
  }
  return normalizeSpans(result);
}

/**
 * Strips one layer of `$$...$$` or `$...$` wrapping from text being
 * converted into an equation's canonical latex source.
 */
export function normalizeEquationLatex(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length > 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function applyEquation(
  spans: readonly InlineSpan[],
  start: number,
  end: number,
  latex: string | null,
): InlineSpan[] {
  const selected = sliceSpans(spans, start, end);
  if (selected.length === 1 && selected[0].kind === 'equation') {
    // Selecting exactly one existing equation atom unwraps it back to plain,
    // editable latex text. The unwrapped text always gets the default style,
    // not the equation's, a formatting mark on an atom does not carry over
    // to its source text.
    return replaceRange(spans, start, end, [plainSpan(selected[0].latex)]);
  }

  // Build the new equation's source from the selection's *display* text (real
  // latex/fraction characters), not the caret-space projection: the caret
  // projection renders every atom in the selection as its placeholder
  // character, which would splice that placeholder straight into the new
  // span's latex. Deliberate divergence from Mnemo.Core's InlineSpanFormatApplier.ApplyEquation,
  // which uses the caret-space flatten here.
  const source = latex ?? normalizeEquationLatex(flattenDisplay(selected));
  return replaceRange(spans, start, end, [{ kind: 'equation', latex: source, style: defaultTextStyle }]);
}

/**
 * The umbrella entry point: toggles a mark over [start, end).
 *
 * The toggle rule is all-on-clears / any-off-sets: if every span overlapping
 * the range already has the mark, the whole range is cleared; otherwise the
 * whole range is set. This is a pure function of current coverage, not of
 * which span the selection was "anchored" from, a selection that starts
 * inside a bold run and ends outside it still turns fully bold, not fully
 * plain, because not every overlapping span has bold yet.
 *
 * `link` is the one exception: it is driven entirely by whether a URL was
 * passed, never by the all/any rule, since "apply this link" and "remove any
 * link" are both meaningful regardless of the current mix.
 */
export function applyFormat(
  spans: readonly InlineSpan[],
  start: number,
  end: number,
  kind: InlineFormat,
  color?: string | null,
): InlineSpan[] {
  if (spans.length === 0 || start < 0 || end <= start) return [...spans];

  const c = color ?? null;
  if (kind === 'equation') return applyEquation(spans, start, end, c);

  const split = splitAt(spans, start, end);
  const allHave = rangeHasFormat(split, start, end, kind, c);

  const result: InlineSpan[] = [];
  let offset = 0;
  for (const span of split) {
    const runEnd = offset + spanCaretLength(span);
    if (offset < end && runEnd > start) {
      const style =
        kind === 'link'
          ? c === null
            ? clearFormat(span.style, 'link')
            : setFormat(span.style, 'link', c)
          : allHave
            ? clearFormat(span.style, kind)
            : setFormat(span.style, kind, c);
      result.push(withStyle(span, style));
    } else {
      result.push(span);
    }
    offset = runEnd;
  }
  return normalizeSpans(result);
}

/**
 * Rewrites `spans` for a single old-text -> new-text edit, found by diffing
 * the common prefix/suffix and treating the middle as one delete-then-insert.
 * Every existing style boundary is preserved; only the run(s) touched by the
 * edit change shape.
 */
export function applyTextEdit(spans: readonly InlineSpan[], oldText: string, newText: string): InlineSpan[] {
  if (spans.length === 0) return [plainSpan(newText)];
  if (oldText === newText) return [...spans];

  const minLen = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  const deleteStart = prefix;
  const deleteEnd = oldText.length - suffix;
  const inserted = newText.slice(prefix, newText.length - suffix);

  const result: InlineSpan[] = [];
  let offset = 0;
  let placed = false;

  for (const span of spans) {
    const runEnd = offset + spanCaretLength(span);

    if (runEnd <= deleteStart || offset >= deleteEnd) {
      // Span untouched by the delete range. A pure insertion (nothing
      // deleted) still needs to land somewhere, exactly once.
      if (deleteStart === deleteEnd && inserted.length > 0 && !placed) {
        if (runEnd === deleteStart) {
          result.push(span);
          result.push(plainSpan(inserted, span.style));
          placed = true;
        } else if (offset === deleteEnd) {
          // Deliberate divergence from native browser behavior (which always
          // inherits from the left): an insertion at document offset 0
          // inherits style from the span to its RIGHT, since there is no
          // left span to inherit from. This branch only fires at a true
          // start-of-document insertion, anywhere else, `runEnd ===
          // deleteStart` above already claimed the insertion from the left.
          result.push(plainSpan(inserted, span.style));
          result.push(span);
          placed = true;
        } else {
          result.push(span);
        }
      } else {
        result.push(span);
      }
    } else if (isTextSpan(span)) {
      if (offset < deleteStart) {
        result.push(plainSpan(span.text.slice(0, deleteStart - offset), span.style));
      }
      if (!placed) {
        placed = true;
        if (inserted.length > 0) result.push(plainSpan(inserted, span.style));
      }
      if (runEnd > deleteEnd) {
        result.push(plainSpan(span.text.slice(deleteEnd - offset), span.style));
      }
    } else {
      // An atom fully consumed by the delete range is dropped; only the
      // inserted text (if any) survives, carrying the atom's style.
      if (!placed) {
        placed = true;
        if (inserted.length > 0) result.push(plainSpan(inserted, span.style));
      }
    }

    offset = runEnd;
  }

  if (!placed && inserted.length > 0) result.push(plainSpan(inserted));
  if (result.length === 0) result.push(plainSpan(''));

  return normalizeSpans(result);
}
