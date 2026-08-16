import { describe, expect, it } from 'vitest';
import { createEditorSchema } from '../editor/schema';
import { createDocumentMapper } from '../editor/mapper/document';
import { allBlockTypes, defaultTextStyle, type Block, type InlineSpan } from '../model/types';
import { renderOutline, typeByCode, typeCodes } from './outline';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

let n = 0;
function blockOf(over: Partial<Block> = {}): Block {
  n += 1;
  return {
    id: `id-${String(n)}`,
    sid: `s${String(n).padStart(4, '0')}`,
    type: 'Text',
    spans: [{ kind: 'text', text: '', style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...over,
  };
}

const text = (t: string): InlineSpan => ({ kind: 'text', text: t, style: { ...defaultTextStyle } });

function outlineOf(blocks: readonly Block[], previewLength?: number): string {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return renderOutline(result.doc, registry, previewLength ? { previewLength } : {});
}

describe('type codes', () => {
  it('covers every block type', () => {
    expect(Object.keys(typeCodes).sort()).toEqual([...allBlockTypes].sort());
  });

  it('assigns a distinct code to each type', () => {
    const codes = Object.values(typeCodes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('round-trips every code back to its type', () => {
    for (const type of allBlockTypes) {
      expect(typeByCode.get(typeCodes[type])).toBe(type);
    }
  });

  it('stays within two characters', () => {
    for (const code of Object.values(typeCodes)) {
      expect(code.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('renderOutline', () => {
  it('emits one line per block, sid then code then preview', () => {
    const outline = outlineOf([
      blockOf({ sid: 'k7m2q', type: 'Heading1', spans: [text('Fourier series')] }),
      blockOf({ sid: 'x9tkd', spans: [text('Two functions are orthogonal.')] }),
    ]);
    expect(outline).toBe('k7m2q h1 Fourier series\nx9tkd p Two functions are orthogonal.');
  });

  it('indents by depth without moving the sid or code columns', () => {
    const outline = outlineOf([
      blockOf({
        sid: 'aaaaa',
        type: 'TwoColumn',
        payload: { kind: 'twoColumn', splitRatio: 0.5 },
        children: [
          blockOf({
            sid: 'bbbbb',
            type: 'ColumnGroup',
            children: [blockOf({ sid: 'ccccc', spans: [text('deep')] })],
          }),
          blockOf({ sid: 'ddddd', type: 'ColumnGroup' }),
        ],
      }),
    ]);
    const lines = outline.split('\n');
    // Every line starts with its 5-character sid at column 0.
    for (const line of lines) {
      expect(line.slice(5, 6)).toBe(' ');
    }
    expect(lines[2]).toBe('ccccc p     deep');
  });

  it('reports a child count only on blocks that have children', () => {
    const outline = outlineOf([
      blockOf({
        sid: 'aaaaa',
        type: 'TwoColumn',
        payload: { kind: 'twoColumn', splitRatio: 0.5 },
        children: [
          blockOf({ sid: 'bbbbb', type: 'ColumnGroup' }),
          blockOf({ sid: 'ccccc', type: 'ColumnGroup' }),
        ],
      }),
    ]);
    const lines = outline.split('\n');
    expect(lines[0]).toContain('(2)');
    expect(lines[1]).not.toContain('(');
  });

  it('shows checked state, which the type op needs to be idempotent', () => {
    const outline = outlineOf([
      blockOf({ sid: 'aaaaa', type: 'Checklist', payload: { kind: 'checklist', checked: true }, spans: [text('done')] }),
      blockOf({ sid: 'bbbbb', type: 'Checklist', payload: { kind: 'checklist', checked: false }, spans: [text('todo')] }),
    ]);
    expect(outline).toBe('aaaaa td [x] done\nbbbbb td [ ] todo');
  });

  it('truncates a long preview', () => {
    const outline = outlineOf([blockOf({ sid: 'aaaaa', spans: [text('x'.repeat(200))] })], 10);
    expect(outline).toBe(`aaaaa p ${'x'.repeat(10)}...`);
  });

  it('collapses newlines so one block is always one line', () => {
    // A multi-line code block or quote must not break the row-per-block
    // contract the format depends on.
    const outline = outlineOf([
      blockOf({
        sid: 'aaaaa',
        type: 'Code',
        spans: [text('let x = 1\nlet y = 2')],
        payload: { kind: 'code', language: 'ts', source: 'let x = 1\nlet y = 2' },
      }),
    ]);
    expect(outline.split('\n')).toHaveLength(1);
    expect(outline).toBe('aaaaa c let x = 1 let y = 2');
  });

  it('emits a bare sid and code for a block with no text', () => {
    expect(outlineOf([blockOf({ sid: 'aaaaa', type: 'Divider' })])).toBe('aaaaa hr');
  });
});
