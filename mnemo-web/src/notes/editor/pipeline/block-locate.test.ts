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
