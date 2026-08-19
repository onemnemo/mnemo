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

  it('keeps a table\'s per-row and per-column header flags', () => {
    const parsed = parseBlock({
      id: 't', type: 'Table', order: 0,
      payload: { kind: 'table', columnWidths: [180, 180], headerRows: [false, true], headerColumns: [true, false], fullWidth: false },
    });
    expect(parsed.payload).toMatchObject({ headerRows: [false, true], headerColumns: [true, false] });
    const again = parseBlock(serializeBlock(parsed));
    expect(again.payload).toEqual(parsed.payload);
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

  it('lifts a legacy table header boolean into the first row or column', () => {
    // Older notes stored a single headerRow / headerCol; a true one becomes a
    // header in position 0 so the table reads the same after the format change.
    const block = parseBlock({
      id: 'x', type: 'Table', order: 0,
      payload: { kind: 'table', columnWidths: [180], headerRow: true, headerCol: false, fullWidth: false },
    });
    expect(block.payload).toMatchObject({ kind: 'table', headerRows: [true], headerColumns: [] });
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

  // Both of these used to read as the nearest known shape, which is what made a
  // note written by a newer version openable as plain paragraphs and then saved
  // back that way. The token survives parsing so the mapper can refuse the note.
  it('keeps an unknown block type rather than reading it as text', () => {
    expect(parseBlock({ id: 'x', type: 'Hologram' }).type).toBe('Hologram');
  });

  it('keeps an unknown payload kind rather than reading it as empty', () => {
    const block = parseBlock({ id: 'x', type: 'Text', payload: { kind: 'quantum' } });
    expect(block.payload).toEqual({ kind: 'quantum' });
    expect(block.id).toBe('x');
  });

  it('still reads a missing or non-string type as text', () => {
    expect(parseBlock({ id: 'x' }).type).toBe('Text');
    expect(parseBlock({ id: 'x', type: '' }).type).toBe('Text');
    expect(parseBlock({ id: 'x', type: {} }).type).toBe('Text');
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
