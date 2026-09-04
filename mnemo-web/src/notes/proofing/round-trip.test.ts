/**
 * Every offset an answer can carry, resolved back into the document it came
 * from.
 *
 * This is the test the whole feature rests on. The projection folds an inline
 * atom's LaTeX in as characters while the atom occupies one caret position, so
 * a segment offset and a document position are not related by addition, and a
 * mark placed as though they were underlines the wrong characters and its
 * "replace this" deletes the equation next to it.
 *
 * The document below holds every inline and block shape that can move the two
 * coordinate spaces apart at once: an equation atom, a fraction atom, an inline
 * code span, a link, a nested list child, a table cell and an image caption.
 * Every word in every segment is stubbed as an issue, and every one of them has
 * to land on a range whose real document text is that word.
 */

import { describe, expect, it } from 'vitest';

import {
  blockOf,
  codeText,
  docOf,
  equation,
  fraction,
  linkText,
  registry,
  tableOf,
  text,
} from './fixtures';
import { checkableSegments, resolveRange } from './segments';

function mixedDocument() {
  return docOf([
    blockOf({ sid: 'head', type: 'Heading1', spans: [text('Reaction kinetics')] }),
    blockOf({
      sid: 'prose',
      spans: [
        text('The rate '),
        equation('\\frac{dc}{dt}'),
        text(' falls once '),
        codeText('kMax'),
        text(' is reached, see '),
        linkText('the rate law', 'https://example.com/rate'),
        text(' for the derivation.'),
      ],
    }),
    blockOf({
      sid: 'outer',
      type: 'BulletList',
      spans: [text('Measure the slope')],
      children: [
        blockOf({
          sid: 'inner',
          type: 'BulletList',
          spans: [text('Half of '), fraction(1, 2), text(' per second')],
        }),
      ],
    }),
    tableOf(
      [
        ['Reagent', 'Order'],
        ['Iodine', 'First'],
      ],
      'tbl',
    ),
    blockOf({
      sid: 'img',
      type: 'Image',
      spans: [text('Titration curve at equivalence')],
      payload: { kind: 'image', path: 'p', alt: 'Titration curve at equivalence', width: 0, align: 'left', crop: null },
    }),
  ]);
}

/** Every word of a segment, as the server would report it back. */
function wordsOf(value: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const match of value.matchAll(/\p{L}[\p{L}'-]*/gu)) {
    const start = match.index;
    out.push({ start, end: start + match[0].length, text: match[0] });
  }
  return out;
}

describe('resolving an answer against the document it was asked about', () => {
  it('lands every stubbed issue on a range holding exactly the flagged text', () => {
    const doc = mixedDocument();
    const segments = checkableSegments(doc, registry);

    let checked = 0;
    for (const segment of segments) {
      for (const word of wordsOf(segment.text)) {
        const range = resolveRange(doc, segment, word.start, word.end, word.text);
        expect(range, `${segment.id} "${word.text}"`).not.toBeNull();
        if (!range) continue;
        expect(doc.textBetween(range.from, range.to)).toBe(word.text);
        checked += 1;
      }
    }

    // A projection change that silently emptied the segment list would make
    // every assertion above pass without checking anything.
    expect(checked).toBeGreaterThan(20);
    expect(segments.map((segment) => segment.sid)).toEqual(
      expect.arrayContaining(['head', 'prose', 'outer', 'inner', 'tbl-c00', 'tbl-c11', 'img']),
    );
  });

  it('never offers a word that only exists inside an atom or an inline code span', () => {
    const doc = mixedDocument();
    const prose = checkableSegments(doc, registry).find((segment) => segment.sid === 'prose');
    expect(prose).toBeDefined();
    const words = wordsOf(prose?.text ?? '').map((word) => word.text);
    expect(words).not.toContain('frac');
    expect(words).not.toContain('dc');
    expect(words).not.toContain('kMax');
    expect(words).toContain('rate');
  });

  it('drops an issue whose text no longer matches the document', () => {
    const doc = mixedDocument();
    const segment = checkableSegments(doc, registry).find((entry) => entry.sid === 'head');
    expect(segment).toBeDefined();
    if (!segment) return;

    // The same offsets, a different word: the answer describes text that has
    // been edited away, and applying it would underline whatever moved in.
    expect(resolveRange(doc, segment, 0, 8, 'Reaction')).not.toBeNull();
    expect(resolveRange(doc, segment, 0, 8, 'Reacshun')).toBeNull();
  });

  it('drops an issue whose range covers an atom, whose text is not there to replace', () => {
    const doc = mixedDocument();
    const segment = checkableSegments(doc, registry).find((entry) => entry.sid === 'prose');
    expect(segment).toBeDefined();
    if (!segment) return;

    const latex = '\\frac{dc}{dt}';
    const at = 'The rate '.length;
    expect(resolveRange(doc, segment, at, at + latex.length, latex)).toBeNull();
  });
});
