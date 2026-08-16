import { describe, expect, it } from 'vitest';

import { caretLength, flattenDisplay, flattenForCaret, normalizeSpans, plainSpan } from './spans';
import { parseBlock, serializeBlock } from './wire';
import { defaultTextStyle, equationAtomChar, type InlineSpan } from './types';

const bold = { ...defaultTextStyle, bold: true };

describe('normalizeSpans', () => {
  it('never returns an empty list, so there is always a caret target', () => {
    expect(normalizeSpans([])).toEqual([plainSpan('')]);
    expect(normalizeSpans([plainSpan(''), plainSpan('')])).toEqual([plainSpan('')]);
  });

  it('merges adjacent text spans sharing a style', () => {
    const merged = normalizeSpans([plainSpan('a'), plainSpan('b'), plainSpan('c')]);
    expect(merged).toEqual([plainSpan('abc')]);
  });

  it('keeps a style boundary intact', () => {
    const spans: InlineSpan[] = [plainSpan('a'), { kind: 'text', text: 'b', style: bold }];
    expect(normalizeSpans(spans)).toHaveLength(2);
  });

  it('does not merge across an atom', () => {
    const spans: InlineSpan[] = [
      plainSpan('a'),
      { kind: 'equation', latex: 'x^2', style: defaultTextStyle },
      plainSpan('b'),
    ];
    expect(normalizeSpans(spans)).toHaveLength(3);
  });

  it('drops empty text spans but keeps empty atoms', () => {
    const spans: InlineSpan[] = [
      plainSpan(''),
      { kind: 'equation', latex: '', style: defaultTextStyle },
      plainSpan(''),
    ];
    expect(normalizeSpans(spans)).toEqual([{ kind: 'equation', latex: '', style: defaultTextStyle }]);
  });
});

describe('flattening', () => {
  const spans: InlineSpan[] = [
    plainSpan('a'),
    { kind: 'equation', latex: '\\frac{1}{2}', style: defaultTextStyle },
    { kind: 'fraction', numerator: 3, denominator: 4, style: defaultTextStyle },
    plainSpan('b'),
  ];

  it('renders atoms in full for display', () => {
    expect(flattenDisplay(spans)).toBe('a\\frac{1}{2}3/4b');
  });

  it('collapses each atom to one character for caret arithmetic', () => {
    expect(flattenForCaret(spans)).toHaveLength(4);
    expect(flattenForCaret(spans)[1]).toBe(equationAtomChar);
  });

  it('agrees with caretLength', () => {
    expect(caretLength(spans)).toBe(flattenForCaret(spans).length);
  });
});

describe('wire round-trip', () => {
  it('preserves a block through parse -> serialize -> parse', () => {
    const original = {
      id: 'b1',
      type: 'Heading2',
      spans: [
        { kind: 'text', text: 'Hello ', style: { bold: true } },
        { kind: 'equation', latex: 'e^{i\\pi}', style: {} },
        { kind: 'fraction', numerator: 1, denominator: 2, style: {} },
      ],
      payload: { kind: 'empty' },
      meta: { custom: 'kept' },
      order: 3,
    };

    const once = parseBlock(original);
    const twice = parseBlock(serializeBlock(once));
    expect(twice).toEqual(once);
    expect(twice.spans).toHaveLength(3);
    expect(twice.meta.custom).toBe('kept');
  });

  it('round-trips nested children', () => {
    const parsed = parseBlock({
      id: 'p', type: 'ColumnGroup', order: 0,
      children: [{ id: 'c1', type: 'Text', order: 0, content: 'inner' }],
    });
    const again = parseBlock(serializeBlock(parsed));
    expect(again.children?.[0].id).toBe('c1');
    expect(flattenDisplay(again.children![0].spans)).toBe('inner');
  });
});

describe('legacy shapes still on disk', () => {
  it('reads a bare content string as a single span', () => {
    const block = parseBlock({ id: 'x', type: 'Text', content: 'legacy text' });
    expect(flattenDisplay(block.spans)).toBe('legacy text');
  });

  it('reads inlineRuns when spans are absent', () => {
    const block = parseBlock({
      id: 'x', type: 'Text',
      inlineRuns: [{ kind: 'text', text: 'run', style: { italic: true } }],
    });
    expect(flattenDisplay(block.spans)).toBe('run');
    expect(block.spans[0].style.italic).toBe(true);
  });

  it('accepts a numeric block type ordinal', () => {
    expect(parseBlock({ id: 'x', type: 1 }).type).toBe('Heading1');
  });

  it('matches property names case-insensitively', () => {
    const block = parseBlock({ Id: 'x', Type: 'Quote', Order: 7 });
    expect(block.id).toBe('x');
    expect(block.type).toBe('Quote');
    expect(block.order).toBe(7);
  });

  it('lifts typed data out of meta when no payload is present', () => {
    const image = parseBlock({
      id: 'x', type: 'Image',
      meta: { imagePath: 'a.png', imageAlt: 'alt', imageWidth: 300, imageAlign: 'center' },
    });
    expect(image.payload).toEqual({ kind: 'image', path: 'a.png', alt: 'alt', width: 300, align: 'center' });

    const code = parseBlock({ id: 'y', type: 'Code', content: 'print(1)', meta: { language: 'python' } });
    expect(code.payload).toEqual({ kind: 'code', language: 'python', source: 'print(1)' });
  });

  it('recognises an equation span written without a kind', () => {
    const block = parseBlock({ id: 'x', type: 'Text', spans: [{ latex: 'x^2' }] });
    expect(block.spans[0].kind).toBe('equation');
  });

  it('backfills code spans from the payload so the block is editable', () => {
    const block = parseBlock({
      id: 'x', type: 'Code',
      spans: [{ kind: 'text', text: '   ' }],
      payload: { kind: 'code', language: 'ts', source: 'const a = 1;' },
    });
    expect(flattenDisplay(block.spans)).toBe('const a = 1;');
  });

  it('clears spans on payload-rendered block types', () => {
    const block = parseBlock({
      id: 'x', type: 'Equation',
      spans: [{ kind: 'text', text: 'stale' }],
      payload: { kind: 'equation', latex: 'a+b' },
    });
    expect(flattenDisplay(block.spans)).toBe('');
  });
});

describe('malformed input degrades instead of throwing', () => {
  it('survives a non-object', () => {
    expect(() => parseBlock(null)).not.toThrow();
    expect(parseBlock(null).type).toBe('Text');
  });

  it('defaults an unknown block type rather than dropping the block', () => {
    expect(parseBlock({ id: 'x', type: 'Hologram' }).type).toBe('Text');
  });

  it('empties an unknown payload kind rather than dropping the block', () => {
    const block = parseBlock({ id: 'x', type: 'Text', payload: { kind: 'quantum' } });
    expect(block.payload).toEqual({ kind: 'empty' });
    expect(block.id).toBe('x');
  });

  it('clamps a non-positive fraction denominator', () => {
    const block = parseBlock({
      id: 'x', type: 'Text',
      spans: [{ kind: 'fraction', numerator: 1, denominator: 0 }],
    });
    expect(block.spans[0]).toMatchObject({ kind: 'fraction', denominator: 1 });
  });

  it('mints an id when one is missing', () => {
    expect(parseBlock({ type: 'Text' }).id).toBeTruthy();
  });
});
