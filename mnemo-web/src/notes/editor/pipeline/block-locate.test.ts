// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { deepestBlockAt } from './block-locate';

const { schema, registry } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const column = (sid: string, ...blocks: PMNode[]) =>
  schema.nodes.columnGroup.create({ sid, id: sid }, [line(), ...blocks]);

/** [p1] [twoColumn: [pA, pB] | [pC]] [p3] */
function mixedDoc(): PMNode {
  const twoColumn = schema.nodes.twoColumn.create({ sid: 'tc', id: 'tc' }, [
    line(),
    column('colL', para('aaaa', 'sA'), para('bbbb', 'sB')),
    column('colR', para('cccc', 'sC')),
  ]);
  return schema.nodes.doc.create(null, [para('one', 's1'), twoColumn, para('three', 's3')]);
}

/** Position of the first block with `sid`, found by walking the document. */
function posOf(doc: PMNode, sid: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if ('sid' in node.attrs && String(node.attrs.sid) === sid) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error(`no block ${sid}`);
  return found;
}

describe('deepestBlockAt', () => {
  it('is the block itself for a position inside a top-level paragraph', () => {
    const doc = mixedDoc();
    const located = deepestBlockAt(doc, registry, posOf(doc, 's1') + 2);
    expect(located?.node.type.name).toBe('paragraph');
    expect(String(located?.node.attrs.sid)).toBe('s1');
    expect(located?.depth).toBe(1);
    expect(located?.topIndex).toBe(0);
  });

  it('is the cell child, not the row, for a position inside a column', () => {
    const doc = mixedDoc();
    const located = deepestBlockAt(doc, registry, posOf(doc, 'sB') + 2);
    expect(String(located?.node.attrs.sid)).toBe('sB');
    expect(located?.depth).toBeGreaterThan(1);
    // The top-level ancestor is still reported, for the reorder.
    expect(located?.topIndex).toBe(1);
    expect(located?.topNode.type.name).toBe('twoColumn');
  });

  it('resolves a between-children position inside a cell to the child it points at', () => {
    const doc = mixedDoc();
    // The position just before sC inside the right cell: only containers on the
    // resolve path, the way posAtDOM reports a NodeView's non-editable face.
    const located = deepestBlockAt(doc, registry, posOf(doc, 'sC'));
    expect(String(located?.node.attrs.sid)).toBe('sC');
    expect(located?.depth).toBeGreaterThan(1);
    expect(located?.topIndex).toBe(1);
  });

  it('falls back to the row for a position that sits only in containers', () => {
    const doc = mixedDoc();
    // Just inside the twoColumn, before its structural line's content: no
    // non-container block on the path.
    const located = deepestBlockAt(doc, registry, posOf(doc, 'tc') + 1);
    expect(located?.node.type.name).toBe('twoColumn');
    expect(located?.depth).toBe(1);
    expect(located?.topIndex).toBe(1);
  });

  it('clamps a past-the-end position to the last block', () => {
    const doc = mixedDoc();
    const located = deepestBlockAt(doc, registry, doc.content.size + 40);
    expect(String(located?.node.attrs.sid)).toBe('s3');
    expect(located?.topIndex).toBe(2);
  });

  it('is null for an empty document', () => {
    const empty = schema.nodes.doc.create(null, []);
    expect(deepestBlockAt(empty, registry, 0)).toBeNull();
  });
});

/**
 * A table is one block, however deep the position is inside it.
 *
 * It shipped the other way. A cell is a registered, non-container block, so the
 * walk kept descending and named the cell, which gave every cell in the table its
 * own drag grip and add button in the gutter. A row and a cell are the table's own
 * structure, and the table carries its own handles for them.
 */
describe('deepestBlockAt inside a table', () => {
  const cell = (text: string, sid: string) =>
    schema.nodes.tableCell.create({ sid, id: sid }, line(text));
  const row = (sid: string, ...cells: PMNode[]) =>
    schema.nodes.tableRow.create({ sid, id: sid }, [line(), ...cells]);

  /** [p1] [table: [a1 a2] [b1 b2]] */
  function tableDoc(): PMNode {
    const table = schema.nodes.table.create({ sid: 'tbl', id: 'tbl', columnWidths: [180, 180] }, [
      line(),
      row('r1', cell('a1', 'ca1'), cell('a2', 'ca2')),
      row('r2', cell('b1', 'cb1'), cell('b2', 'cb2')),
    ]);
    return schema.nodes.doc.create(null, [para('one', 's1'), table]);
  }

  it('names the table for a position in a cell, not the cell', () => {
    const doc = tableDoc();
    const located = deepestBlockAt(doc, registry, posOf(doc, 'cb2') + 2);
    expect(located?.node.type.name).toBe('table');
    expect(String(located?.node.attrs.sid)).toBe('tbl');
  });

  it('names the table from every cell, so the gutter never moves inside it', () => {
    const doc = tableDoc();
    for (const sid of ['ca1', 'ca2', 'cb1', 'cb2']) {
      const located = deepestBlockAt(doc, registry, posOf(doc, sid) + 2);
      expect(String(located?.node.attrs.sid), `from ${sid}`).toBe('tbl');
    }
  });

  it('still names a paragraph outside the table', () => {
    const doc = tableDoc();
    expect(deepestBlockAt(doc, registry, posOf(doc, 's1') + 2)?.node.type.name).toBe('paragraph');
  });
});

/**
 * The O(position) computation `deepestBlockAt` used for `topPos`/`topIndex`
 * before it started reusing `$pos.before(1)`. Kept independent of the function
 * under test, so the sweep below proves the fast path against the slow one
 * rather than against itself.
 */
function oldTopPosAndIndex(doc: PMNode, pos: number): { topPos: number; topIndex: number } {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  const topIndex = Math.min($pos.index(0), doc.childCount - 1);
  let topPos = 0;
  for (let i = 0; i < topIndex; i++) topPos += doc.child(i).nodeSize;
  return { topPos, topIndex };
}

/** 200+ top-level blocks, alternating type, with text length varying block to block. */
function manyVariedBlocksDoc(): PMNode {
  const kids: PMNode[] = [];
  for (let i = 0; i < 220; i++) {
    const sid = `v${String(i)}`;
    const body = 'x'.repeat((i * 37) % 61);
    kids.push(i % 5 === 0 ? schema.nodes.quote.create({ sid, id: sid }, line(body)) : para(body, sid));
  }
  return schema.nodes.doc.create(null, kids);
}

/**
 * `topPos`/`topIndex` now come from `$pos.before(1)`, the position `$pos`
 * already resolved, instead of a fresh sum of every earlier sibling's
 * `nodeSize`. Past the last child that position has nothing to name at depth
 * 0 and answers with the clamped position rather than the last block's start,
 * which is why the clamped branch keeps the walk. This sweeps every position
 * so that boundary stays proven, not just asserted.
 */
describe('deepestBlockAt: topPos/topIndex against the old computation', () => {
  function sweep(doc: PMNode): { swept: number; mismatches: unknown[] } {
    const max = doc.content.size + 3;
    const mismatches: Array<{ pos: number; expected: { topPos: number; topIndex: number }; actual: unknown }> = [];
    for (let pos = 0; pos <= max; pos++) {
      const expected = oldTopPosAndIndex(doc, pos);
      const located = deepestBlockAt(doc, registry, pos);
      const actual = located && { topPos: located.topPos, topIndex: located.topIndex };
      if (!actual || actual.topPos !== expected.topPos || actual.topIndex !== expected.topIndex) {
        mismatches.push({ pos, expected, actual });
      }
    }
    return { swept: max + 1, mismatches };
  }

  it('matches on every position from 0 to content.size + 3, small mixed doc', () => {
    const { swept, mismatches } = sweep(mixedDoc());
    expect(mismatches, `${String(mismatches.length)} of ${String(swept)} swept positions mismatched`).toEqual([]);
  });

  it('matches on every position from 0 to content.size + 3, 200+ blocks of varied size', () => {
    const doc = manyVariedBlocksDoc();
    expect(doc.childCount).toBeGreaterThanOrEqual(200);
    const { swept, mismatches } = sweep(doc);
    expect(mismatches, `${String(mismatches.length)} of ${String(swept)} swept positions mismatched`).toEqual([]);
  });
});
