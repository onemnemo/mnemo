import { describe, expect, it } from 'vitest';

import {
  applyFormat,
  applyTextEdit,
  clearFormat,
  forceSubSup,
  hasFormat,
  normalizeEquationLatex,
  rangeHasFormat,
  replaceRange,
  setFormat,
  sliceSpans,
  splitAt,
  toggleFormat,
  withStyle,
} from './format';
import { flattenDisplay, plainSpan } from './spans';
import { defaultTextStyle, type InlineSpan } from './types';

const bold = { ...defaultTextStyle, bold: true };
const italic = { ...defaultTextStyle, italic: true };

describe('TextStyle mark operations', () => {
  it('hasFormat reads each flag/field', () => {
    expect(hasFormat(bold, 'bold')).toBe(true);
    expect(hasFormat(defaultTextStyle, 'bold')).toBe(false);
    expect(hasFormat({ ...defaultTextStyle, backgroundColor: 'red' }, 'bg')).toBe(true);
    expect(hasFormat(defaultTextStyle, 'equation')).toBe(false);
  });

  it('setFormat/clearFormat toggle simple boolean marks', () => {
    expect(setFormat(defaultTextStyle, 'italic').italic).toBe(true);
    expect(clearFormat(italic, 'italic').italic).toBe(false);
  });

  it('setFormat/clearFormat set and clear color marks', () => {
    const withBg = setFormat(defaultTextStyle, 'bg', 'swatch3');
    expect(withBg.backgroundColor).toBe('swatch3');
    expect(clearFormat(withBg, 'bg').backgroundColor).toBeNull();
  });

  it('clearing a link sets suppressAutoLink so autolink does not immediately reattach it', () => {
    const linked = setFormat(defaultTextStyle, 'link', 'https://a.com');
    expect(linked.linkUrl).toBe('https://a.com');
    expect(linked.suppressAutoLink).toBe(false);

    const cleared = clearFormat(linked, 'link');
    expect(cleared.linkUrl).toBeNull();
    expect(cleared.suppressAutoLink).toBe(true);
  });

  it('setFormat("link", url) resets suppressAutoLink even if it was set', () => {
    const suppressed = { ...defaultTextStyle, suppressAutoLink: true };
    const relinked = setFormat(suppressed, 'link', 'https://b.com');
    expect(relinked.linkUrl).toBe('https://b.com');
    expect(relinked.suppressAutoLink).toBe(false);
  });

  it('clearing an already-unlinked style is a no-op', () => {
    expect(clearFormat(defaultTextStyle, 'link')).toEqual(defaultTextStyle);
  });

  it('toggling link off clears and suppresses; toggling an unset link is a no-op', () => {
    const linked = setFormat(defaultTextStyle, 'link', 'https://a.com');
    const toggled = toggleFormat(linked, 'link');
    expect(toggled.linkUrl).toBeNull();
    expect(toggled.suppressAutoLink).toBe(true);

    expect(toggleFormat(defaultTextStyle, 'link', 'https://ignored.com')).toEqual(defaultTextStyle);
  });

  it('sub/sup are mutually exclusive under setFormat', () => {
    const sup = setFormat(defaultTextStyle, 'sup');
    expect(sup.superscript).toBe(true);
    expect(sup.subscript).toBe(false);

    const sub = setFormat(sup, 'sub');
    expect(sub.subscript).toBe(true);
    expect(sub.superscript).toBe(false);
  });

  it('sub/sup are mutually exclusive under toggleFormat', () => {
    let style = toggleFormat(defaultTextStyle, 'sub');
    expect(style).toMatchObject({ subscript: true, superscript: false });

    style = toggleFormat(style, 'sup');
    expect(style).toMatchObject({ subscript: false, superscript: true });

    style = toggleFormat(style, 'sup');
    expect(style).toMatchObject({ subscript: false, superscript: false });
  });

  it('clearFormat only clears its own sub/sup flag', () => {
    const both = { ...defaultTextStyle, subscript: true, superscript: true };
    expect(clearFormat(both, 'sub')).toMatchObject({ subscript: false, superscript: true });
    expect(clearFormat(both, 'sup')).toMatchObject({ subscript: true, superscript: false });
  });

  it('toggleFormat turning sub/sup OFF leaves the other flag untouched, even when both are set', () => {
    // Mirrors C#'s `this with { Subscript = !Subscript, Superscript = Subscript ? Superscript : false }`:
    // the RHS reads the ORIGINAL value, so turning a flag off is not the same
    // as clearing the other one, only turning a flag ON does that.
    const both = { ...defaultTextStyle, subscript: true, superscript: true };
    expect(toggleFormat(both, 'sub')).toMatchObject({ subscript: false, superscript: true });
    expect(toggleFormat(both, 'sup')).toMatchObject({ subscript: true, superscript: false });
  });
});

describe('withStyle', () => {
  it('replaces style, keeps the same span kind', () => {
    const span: InlineSpan = { kind: 'equation', latex: 'x', style: defaultTextStyle };
    const restyled = withStyle(span, bold);
    expect(restyled).toEqual({ kind: 'equation', latex: 'x', style: bold });
  });
});

describe('sliceSpans', () => {
  const spans: InlineSpan[] = [
    plainSpan('hello', bold),
    { kind: 'equation', latex: 'x^2', style: defaultTextStyle },
    plainSpan('world'),
  ];

  it('clamps start/end into range', () => {
    expect(flattenDisplay(sliceSpans(spans, -5, 1000))).toBe('hellox^2world');
  });

  it('returns [] when start >= end', () => {
    expect(sliceSpans(spans, 3, 3)).toEqual([]);
    expect(sliceSpans(spans, 5, 2)).toEqual([]);
  });

  it('substrings text spans by local offset, preserving style', () => {
    const sliced = sliceSpans(spans, 1, 4);
    expect(sliced).toEqual([plainSpan('ell', bold)]);
  });

  it('includes an atom only when the range covers it exactly', () => {
    // "hello" is 5 chars, so caret offset 5 is exactly where the equation atom starts.
    const exact = sliceSpans(spans, 5, 6);
    expect(exact).toEqual([{ kind: 'equation', latex: 'x^2', style: defaultTextStyle }]);
  });

  it('an atom is included only for the exact range that covers it, never for its neighbors', () => {
    // "hello" occupies caret offsets [0,5), so the equation atom is exactly [5,6).
    expect(sliceSpans(spans, 5, 6)).toEqual([{ kind: 'equation', latex: 'x^2', style: defaultTextStyle }]);

    // The adjacent range on either side overlaps zero caret units of the atom
    // (since atoms are exactly one caret unit wide, there is no range that
    // "clips into" one without covering it fully), both must exclude it.
    expect(sliceSpans(spans, 4, 5).some((s) => s.kind === 'equation')).toBe(false);
    expect(sliceSpans(spans, 6, 7).some((s) => s.kind === 'equation')).toBe(false);
  });
});

describe('splitAt', () => {
  it('does not clip the document, spans outside the range still come back', () => {
    const spans: InlineSpan[] = [plainSpan('abcdef')];
    const split = splitAt(spans, 2, 4);
    expect(flattenDisplay(split)).toBe('abcdef');
  });

  it('cuts a text span into three pieces when both boundaries fall inside it', () => {
    const spans: InlineSpan[] = [plainSpan('abcdef')];
    const split = splitAt(spans, 2, 4);
    expect(split).toEqual([plainSpan('ab'), plainSpan('cd'), plainSpan('ef')]);
  });

  it('cuts into two pieces when only one boundary falls inside', () => {
    const spans: InlineSpan[] = [plainSpan('abcdef')];
    expect(splitAt(spans, 2, 6)).toEqual([plainSpan('ab'), plainSpan('cdef')]);
    expect(splitAt(spans, 0, 3)).toEqual([plainSpan('abc'), plainSpan('def')]);
  });

  it('passes atoms through whole even when the range covers them', () => {
    const spans: InlineSpan[] = [
      plainSpan('ab'),
      { kind: 'equation', latex: 'x', style: defaultTextStyle },
      plainSpan('cd'),
    ];
    const split = splitAt(spans, 1, 3);
    expect(split.filter((s) => s.kind === 'equation')).toHaveLength(1);
  });

  it('leaves a span untouched when the boundaries do not fall in its interior', () => {
    const spans: InlineSpan[] = [plainSpan('abc'), plainSpan('def', bold)];
    expect(splitAt(spans, 0, 3)).toEqual(spans);
  });
});

describe('rangeHasFormat', () => {
  it('is true only when every overlapping span has the mark', () => {
    const spans: InlineSpan[] = [plainSpan('ab', bold), plainSpan('cd', bold)];
    expect(rangeHasFormat(spans, 0, 4, 'bold')).toBe(true);

    const mixed: InlineSpan[] = [plainSpan('ab', bold), plainSpan('cd')];
    expect(rangeHasFormat(mixed, 0, 4, 'bold')).toBe(false);
  });

  it('requires exact color-string equality for bg/fg, not merely non-null', () => {
    const sameColor: InlineSpan[] = [
      plainSpan('ab', { ...defaultTextStyle, backgroundColor: 'swatch1' }),
      plainSpan('cd', { ...defaultTextStyle, backgroundColor: 'swatch1' }),
    ];
    expect(rangeHasFormat(sameColor, 0, 4, 'bg', 'swatch1')).toBe(true);

    const differentColor: InlineSpan[] = [
      plainSpan('ab', { ...defaultTextStyle, backgroundColor: 'swatch1' }),
      plainSpan('cd', { ...defaultTextStyle, backgroundColor: 'swatch2' }),
    ];
    expect(rangeHasFormat(differentColor, 0, 4, 'bg', 'swatch1')).toBe(false);
  });
});

describe('replaceRange', () => {
  it('splices insertion between the untouched head and tail', () => {
    const spans: InlineSpan[] = [plainSpan('hello world')];
    const replaced = replaceRange(spans, 6, 11, [plainSpan('there', bold)]);
    expect(replaced).toEqual([plainSpan('hello '), plainSpan('there', bold)]);
  });

  it('swaps start/end when start > end, same result as passing them in order', () => {
    const spans: InlineSpan[] = [plainSpan('hello world')];
    const swapped = replaceRange(spans, 11, 6, [plainSpan('there', bold)]);
    const ordered = replaceRange(spans, 6, 11, [plainSpan('there', bold)]);
    expect(swapped).toEqual(ordered);
  });

  it('clamps out-of-bounds start/end into the document', () => {
    const spans: InlineSpan[] = [plainSpan('abc')];
    expect(replaceRange(spans, -10, 100, [plainSpan('X')])).toEqual([plainSpan('X')]);
    expect(replaceRange(spans, 1, 100, [plainSpan('X')])).toEqual([plainSpan('aX')]);
  });

  it('an empty insertion just deletes the range', () => {
    const spans: InlineSpan[] = [plainSpan('hello world')];
    expect(replaceRange(spans, 5, 11, [])).toEqual([plainSpan('hello')]);
  });
});

describe('forceSubSup', () => {
  it('is a no-op copy when spans are empty or start >= end', () => {
    expect(forceSubSup([], 0, 1, true, false)).toEqual([]);
    const spans: InlineSpan[] = [plainSpan('ab')];
    expect(forceSubSup(spans, 2, 2, true, false)).toEqual(spans);
  });

  it('unconditionally overwrites sub/sup on every overlapping span regardless of prior state', () => {
    const spans: InlineSpan[] = [
      plainSpan('ab', { ...defaultTextStyle, superscript: true }),
      plainSpan('cd'),
    ];
    const forced = forceSubSup(spans, 0, 4, true, false);
    expect(forced.every((s) => s.style.subscript === true && s.style.superscript === false)).toBe(true);
  });
});

describe('normalizeEquationLatex', () => {
  it('strips one layer of $$...$$ or $...$ wrapping', () => {
    expect(normalizeEquationLatex('$$x^2$$')).toBe('x^2');
    expect(normalizeEquationLatex('$x^2$')).toBe('x^2');
    expect(normalizeEquationLatex('x^2')).toBe('x^2');
    expect(normalizeEquationLatex('   ')).toBe('');
  });
});

describe('applyFormat', () => {
  it('copies through unchanged for an empty span list, negative start, or end <= start', () => {
    expect(applyFormat([], 0, 1, 'bold')).toEqual([]);
    const spans: InlineSpan[] = [plainSpan('ab')];
    expect(applyFormat(spans, -1, 2, 'bold')).toEqual(spans);
    expect(applyFormat(spans, 2, 2, 'bold')).toEqual(spans);
  });

  it('all-on-clears: a fully bold range toggles fully off', () => {
    const spans: InlineSpan[] = [plainSpan('abcd', bold)];
    const result = applyFormat(spans, 0, 4, 'bold');
    expect(flattenDisplay(result)).toBe('abcd');
    expect(result).toEqual([plainSpan('abcd')]);
  });

  it('any-off-sets: a partially bold range toggles fully on, not off', () => {
    const spans: InlineSpan[] = [plainSpan('ab', bold), plainSpan('cd')];
    const result = applyFormat(spans, 0, 4, 'bold');
    expect(flattenDisplay(result)).toBe('abcd');
    expect(result).toEqual([plainSpan('abcd', bold)]);
  });

  it('any-off-sets even when only one of many spans lacks the mark', () => {
    const spans: InlineSpan[] = [
      plainSpan('a', bold),
      plainSpan('b', bold),
      plainSpan('c'),
      plainSpan('d', bold),
    ];
    const result = applyFormat(spans, 0, 4, 'bold');
    expect(flattenDisplay(result)).toBe('abcd');
    expect(result).toEqual([plainSpan('abcd', bold)]);
  });

  it('bg all-on-clears through applyFormat: every span sharing a color clears when that color is reapplied', () => {
    const swatch1 = { ...defaultTextStyle, backgroundColor: 'swatch1' };
    const spans: InlineSpan[] = [plainSpan('ab', swatch1), plainSpan('cd', swatch1)];

    const cleared = applyFormat(spans, 0, 4, 'bg', 'swatch1');
    expect(cleared).toEqual([plainSpan('abcd')]);

    const reset = applyFormat(cleared, 0, 4, 'bg', 'swatch2');
    expect(reset).toEqual([plainSpan('abcd', { ...defaultTextStyle, backgroundColor: 'swatch2' })]);
  });

  it('fg all-on-clears through applyFormat: every span sharing a color clears when that color is reapplied', () => {
    const swatch1 = { ...defaultTextStyle, foregroundColor: 'swatch1' };
    const spans: InlineSpan[] = [plainSpan('ab', swatch1), plainSpan('cd', swatch1)];

    const cleared = applyFormat(spans, 0, 4, 'fg', 'swatch1');
    expect(cleared).toEqual([plainSpan('abcd')]);

    const reset = applyFormat(cleared, 0, 4, 'fg', 'swatch2');
    expect(reset).toEqual([plainSpan('abcd', { ...defaultTextStyle, foregroundColor: 'swatch2' })]);
  });

  it('an equation atom inside the range gets restyled and counts toward the all-on check', () => {
    const spans: InlineSpan[] = [plainSpan('ab', bold), { kind: 'equation', latex: 'x', style: bold }];
    // Fully bold already (text + atom) -> applying bold again clears both.
    const cleared = applyFormat(spans, 0, 3, 'bold');
    expect(cleared).toEqual([plainSpan('ab'), { kind: 'equation', latex: 'x', style: defaultTextStyle }]);

    // The atom lacking bold is enough to make the range "not all on" -> sets both.
    const mixed: InlineSpan[] = [plainSpan('ab', bold), { kind: 'equation', latex: 'x', style: defaultTextStyle }];
    const set = applyFormat(mixed, 0, 3, 'bold');
    expect(set).toEqual([plainSpan('ab', bold), { kind: 'equation', latex: 'x', style: bold }]);
  });

  it('splits only the spans that need a new style boundary', () => {
    const spans: InlineSpan[] = [plainSpan('hello world')];
    const result = applyFormat(spans, 0, 5, 'bold');
    expect(result).toEqual([plainSpan('hello', bold), plainSpan(' world')]);
  });

  it('link is driven by whether a url was passed, not by all/any coverage', () => {
    const spans: InlineSpan[] = [plainSpan('ab', { ...defaultTextStyle, linkUrl: 'https://a.com' })];
    // Every span already has a link, under the normal all/any rule this
    // would clear. Passing a (different) url still sets it instead.
    const relinked = applyFormat(spans, 0, 2, 'link', 'https://b.com');
    expect(relinked).toEqual([plainSpan('ab', { ...defaultTextStyle, linkUrl: 'https://b.com' })]);

    const cleared = applyFormat(relinked, 0, 2, 'link');
    expect(cleared).toEqual([plainSpan('ab', { ...defaultTextStyle, suppressAutoLink: true })]);
  });

  it('wraps a plain-text selection into a new equation span', () => {
    const spans: InlineSpan[] = [plainSpan('x^2 + 1')];
    const result = applyFormat(spans, 0, 7, 'equation');
    expect(result).toEqual([{ kind: 'equation', latex: 'x^2 + 1', style: defaultTextStyle }]);
  });

  it('unwraps a fully-selected existing equation back to plain text', () => {
    const spans: InlineSpan[] = [{ kind: 'equation', latex: 'x^2', style: bold }];
    const result = applyFormat(spans, 0, 1, 'equation');
    expect(result).toEqual([plainSpan('x^2')]);
  });

  it('merging text with an existing equation atom uses the atom\'s real latex, not the caret placeholder', () => {
    // Deliberate divergence from Mnemo.Core's InlineSpanFormatApplier.ApplyEquation
    // (which flattens through caret space here): the port builds the merged
    // source from flattenDisplay, so the atom's actual latex is spliced in
    // rather than its caret-space placeholder character.
    const spans: InlineSpan[] = [plainSpan('E='), { kind: 'equation', latex: 'mc^2', style: defaultTextStyle }];
    const result = applyFormat(spans, 0, 3, 'equation');
    expect(result).toEqual([{ kind: 'equation', latex: 'E=mc^2', style: defaultTextStyle }]);
  });

  it('merging text with an existing fraction atom uses "n/d", not the caret placeholder', () => {
    const spans: InlineSpan[] = [plainSpan('x='), { kind: 'fraction', numerator: 1, denominator: 2, style: defaultTextStyle }];
    const result = applyFormat(spans, 0, 3, 'equation');
    expect(result).toEqual([{ kind: 'equation', latex: 'x=1/2', style: defaultTextStyle }]);
  });
});

describe('applyTextEdit', () => {
  it('returns a copy when old and new text are identical', () => {
    const spans: InlineSpan[] = [plainSpan('same')];
    expect(applyTextEdit(spans, 'same', 'same')).toEqual(spans);
  });

  it('mid-document insertion inherits style from the LEFT span', () => {
    const spans: InlineSpan[] = [plainSpan('ab', bold), plainSpan('ef')];
    // old: "abef" -> new: "abXef" (insert "X" right after the bold run)
    const result = applyTextEdit(spans, 'abef', 'abXef');
    expect(flattenDisplay(result)).toBe('abXef');
    // The inserted "X" should have joined the bold run (inherits from the left).
    expect(result[0]).toEqual(plainSpan('abX', bold));
  });

  it('insertion at offset 0 inherits style from the RIGHT span, not the left', () => {
    const spans: InlineSpan[] = [plainSpan('bc', italic)];
    // old: "bc" -> new: "Xbc" (insert "X" at the very start of the document)
    const result = applyTextEdit(spans, 'bc', 'Xbc');
    expect(flattenDisplay(result)).toBe('Xbc');
    expect(result).toEqual([plainSpan('Xbc', italic)]);
  });

  it('deletes a run in the middle, preserving the surviving boundaries', () => {
    const spans: InlineSpan[] = [plainSpan('hello world')];
    const result = applyTextEdit(spans, 'hello world', 'hello ');
    expect(flattenDisplay(result)).toBe('hello ');
  });

  it('deleting an atom drops it, replacing it with any inserted text', () => {
    const spans: InlineSpan[] = [
      plainSpan('a'),
      { kind: 'equation', latex: 'x^2', style: bold },
      plainSpan('b'),
    ];
    // Caret-space old text is "a￼b"; replace the atom with "Y".
    const oldText = 'a￼b';
    const newText = 'aYb';
    const result = applyTextEdit(spans, oldText, newText);
    expect(result.some((s) => s.kind === 'equation')).toBe(false);
    expect(flattenDisplay(result)).toBe('aYb');
    // The replacement inherits the consumed atom's style.
    expect(result.find((s) => s.kind === 'text' && s.text === 'Y')?.style.bold).toBe(true);
  });

  it('replacing a range spanning multiple styles keeps only one insertion, styled from the first touched span', () => {
    const spans: InlineSpan[] = [plainSpan('ab', bold), plainSpan('cd', italic), plainSpan('ef')];
    // old: "abcdef" -> new: "aZf" (delete "bcde", insert "Z")
    const result = applyTextEdit(spans, 'abcdef', 'aZf');
    expect(flattenDisplay(result)).toBe('aZf');
    // The inserted "Z" takes the style of the first (bold) span it landed in,
    // and normalizeSpans then merges it with that span's surviving prefix "a".
    expect(result).toEqual([plainSpan('aZ', bold), plainSpan('f')]);
  });

  it('falls back to a single new span when the original list was empty', () => {
    expect(applyTextEdit([], '', 'new')).toEqual([plainSpan('new')]);
  });

  it('deleting everything collapses to one empty plain span with the DEFAULT style, discarding the deleted run\'s style', () => {
    // Faithful to C#: the deleted run's style does not survive an edit that
    // consumes it entirely -- there is nothing left for a mark to attach to.
    const spans: InlineSpan[] = [plainSpan('hello', bold)];
    const result = applyTextEdit(spans, 'hello', '');
    expect(result).toEqual([plainSpan('')]);
    expect(result[0].style).toEqual(defaultTextStyle);
  });

  it('indexes UTF-16 code units, not Unicode code points -- a surrogate pair can be split by an edit', () => {
    // Faithful to C# (UTF-16 strings both sides): this is a deliberate,
    // documented consequence of code-unit indexing, not a bug to fix. An edit
    // that lands between a surrogate pair's two halves splits it rather than
    // treating the emoji as one atomic unit.
    const spans: InlineSpan[] = [plainSpan('a😀b')];
    const result = applyTextEdit(spans, 'a😀b', 'a\uD83Db');
    expect(flattenDisplay(result)).toBe('a\uD83Db');
    expect(result).toEqual([plainSpan('a\uD83Db')]);
  });
});
