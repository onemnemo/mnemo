import { describe, expect, it } from 'vitest';
import { createEditorSchema } from '../schema';
import { createDocumentMapper } from '../mapper/document';
import { defaultTextStyle, type Block, type InlineSpan } from '../../model/types';
import { documentPositionOf, projectDocument, walkBlocks } from './document';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

let nextSid = 0;
function blockOf(over: Partial<Block> = {}): Block {
  nextSid += 1;
  return {
    id: `id-${String(nextSid)}`,
    sid: `s${String(nextSid).padStart(4, '0')}`,
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

function docOf(blocks: readonly Block[]) {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

describe('walkBlocks', () => {
  it('returns blocks in document order with parents before children', () => {
    const cell = (sid: string, kids: Block[]) =>
      blockOf({ type: 'ColumnGroup', sid, children: kids });
    const doc = docOf([
      blockOf({ sid: 'aaa', spans: [text('first')] }),
      blockOf({
        type: 'TwoColumn',
        sid: 'two',
        payload: { kind: 'twoColumn', splitRatio: 0.5 },
        children: [
          cell('left', [blockOf({ sid: 'lkid', spans: [text('in left')] })]),
          cell('right', []),
        ],
      }),
    ]);

    expect(walkBlocks(doc, registry).map((b) => b.sid)).toEqual([
      'aaa',
      'two',
      'left',
      'lkid',
      'right',
    ]);
  });

  it('reports a position the document actually resolves to that block', () => {
    const doc = docOf([
      blockOf({ spans: [text('alpha')] }),
      blockOf({ type: 'Quote', spans: [text('beta')] }),
    ]);
    for (const entry of walkBlocks(doc, registry)) {
      // The real check: PM itself agrees the node lives there.
      expect(doc.nodeAt(entry.pos)).toBe(entry.node);
    }
  });

  it('does not count the mandatory line as a block child', () => {
    const doc = docOf([
      blockOf({
        type: 'TwoColumn',
        payload: { kind: 'twoColumn', splitRatio: 0.5 },
        children: [blockOf({ type: 'ColumnGroup' }), blockOf({ type: 'ColumnGroup' })],
      }),
    ]);
    const [twoColumn] = walkBlocks(doc, registry);
    expect(twoColumn.childCount).toBe(2);
  });

  it('reports depth and parentage', () => {
    const doc = docOf([
      blockOf({
        type: 'TwoColumn',
        sid: 'tc',
        payload: { kind: 'twoColumn', splitRatio: 0.5 },
        children: [
          blockOf({ type: 'ColumnGroup', sid: 'cg', children: [blockOf({ sid: 'deep' })] }),
          blockOf({ type: 'ColumnGroup', sid: 'cg2' }),
        ],
      }),
    ]);
    const byId = new Map(walkBlocks(doc, registry).map((b) => [b.sid, b]));
    expect(byId.get('tc')).toMatchObject({ depth: 0, parentSid: null, index: 0 });
    expect(byId.get('cg')).toMatchObject({ depth: 1, parentSid: 'tc', index: 0 });
    expect(byId.get('cg2')).toMatchObject({ depth: 1, parentSid: 'tc', index: 1 });
    expect(byId.get('deep')).toMatchObject({ depth: 2, parentSid: 'cg', index: 0 });
  });

  it('distinguishes the four heading levels without serializing the block', () => {
    const doc = docOf([
      blockOf({ type: 'Heading1', spans: [text('one')] }),
      blockOf({ type: 'Heading3', spans: [text('three')] }),
    ]);
    expect(walkBlocks(doc, registry).map((b) => b.type)).toEqual(['Heading1', 'Heading3']);
  });
});

describe('projectDocument', () => {
  it('projects one block per line', () => {
    const doc = docOf([blockOf({ spans: [text('alpha')] }), blockOf({ spans: [text('beta')] })]);
    expect(projectDocument(doc, registry).text).toBe('alpha\nbeta\n');
  });

  it('projects a container and its children as separate lines', () => {
    // A container's own text must not include its children's, or find would
    // report two locations for one string.
    const doc = docOf([
      blockOf({
        type: 'TwoColumn',
        payload: { kind: 'twoColumn', splitRatio: 0.5 },
        children: [
          blockOf({ type: 'ColumnGroup', children: [blockOf({ spans: [text('inside')] })] }),
          blockOf({ type: 'ColumnGroup' }),
        ],
      }),
    ]);
    const projection = projectDocument(doc, registry);
    expect(projection.text.split('\n').filter((l) => l.length > 0)).toEqual(['inside']);
  });

  it('agrees with the block projections about where every segment starts', () => {
    // The invariant the whole file exists for: a segment's document offset must
    // index the document text at exactly that segment's own text.
    const doc = docOf([
      blockOf({ spans: [text('alpha')] }),
      blockOf({ type: 'Code', spans: [text('let x = 1')], payload: { kind: 'code', language: 'ts', source: 'let x = 1' } }),
      blockOf({ type: 'Quote', spans: [text('beta')] }),
    ]);
    const projection = projectDocument(doc, registry);
    for (const segment of projection.segments) {
      expect(
        projection.text.slice(segment.docOffset, segment.docOffset + segment.text.length),
        `segment ${segment.kind} "${segment.text}" is not at ${String(segment.docOffset)}`,
      ).toBe(segment.text);
    }
  });

  it('tags a code block as code rather than prose', () => {
    const doc = docOf([
      blockOf({
        type: 'Code',
        spans: [text('let x = 1')],
        payload: { kind: 'code', language: 'ts', source: 'let x = 1' },
      }),
    ]);
    expect(projectDocument(doc, registry).segments.map((s) => s.kind)).toEqual(['code']);
  });

  it('projects a note with no blocks as its one seeded empty block', () => {
    // An empty document is not representable — the schema requires `block+` —
    // so the mapper seeds one, and the projection sees a single blank line.
    const projection = projectDocument(docOf([]), registry);
    expect(projection.blocks).toHaveLength(1);
    expect(projection.text).toBe('\n');
    expect(projection.segments).toEqual([]);
  });

  it('does not move an earlier block offset when a block is appended', () => {
    const first = blockOf({ spans: [text('alpha')] });
    const before = projectDocument(docOf([first]), registry);
    const after = projectDocument(docOf([first, blockOf({ spans: [text('beta')] })]), registry);
    expect(after.segments[0].docOffset).toBe(before.segments[0].docOffset);
    expect(after.text.startsWith(before.text)).toBe(true);
  });
});

describe('documentPositionOf', () => {
  it('round-trips every offset to a position holding the expected character', () => {
    const doc = docOf([
      blockOf({ spans: [text('alpha')] }),
      blockOf({ type: 'Quote', spans: [text('beta')] }),
    ]);
    const projection = projectDocument(doc, registry);

    for (let offset = 0; offset < projection.text.length; offset += 1) {
      const char = projection.text[offset];
      if (char === '\n') continue;
      const pos = documentPositionOf(projection, offset);
      expect(pos, `offset ${String(offset)} did not resolve`).not.toBeNull();
      expect(doc.textBetween(pos as number, (pos as number) + 1)).toBe(char);
    }
  });

  it('resolves an offset at a block boundary to the block that ends there', () => {
    const doc = docOf([blockOf({ spans: [text('alpha')] }), blockOf({ spans: [text('beta')] })]);
    const projection = projectDocument(doc, registry);
    const endOfFirst = documentPositionOf(projection, 5);
    expect(endOfFirst).not.toBeNull();
    // Still inside the first block, not at the start of the second.
    expect(doc.resolve(endOfFirst as number).parent.textContent).toBe('alpha');
  });

  it('returns null past the end rather than clamping into the last block', () => {
    const projection = projectDocument(docOf([blockOf({ spans: [text('alpha')] })]), registry);
    expect(documentPositionOf(projection, 999)).toBeNull();
  });
});
