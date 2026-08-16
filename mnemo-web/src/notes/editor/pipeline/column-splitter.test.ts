// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { clampRatio, columnSplitterDecorations } from './column-splitter';

const { schema } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function cell(...blocks: PMNode[]): PMNode {
  return schema.nodes.columnGroup.create(null, [line(), ...blocks]);
}
function twoColumn(left: PMNode, right: PMNode): PMNode {
  return schema.nodes.twoColumn.create(null, [line(), left, right]);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

describe('clampRatio', () => {
  it('holds a lane to a visible minimum on each side', () => {
    expect(clampRatio(0.02)).toBe(0.1);
    expect(clampRatio(0.98)).toBe(0.9);
  });
  it('passes an in-range ratio through', () => {
    expect(clampRatio(0.5725)).toBe(0.5725);
  });
});

describe('columnSplitterDecorations', () => {
  it('places one splitter between the two cells of a split', () => {
    const tc = twoColumn(cell(para('L')), cell(para('R')));
    const document = doc(para('before'), tc);
    const decos = columnSplitterDecorations(document);

    expect(decos).toHaveLength(1);
    // The widget sits exactly on the seam: everything before it resolves inside
    // the left cell, everything after inside the right.
    const at = decos[0].from;
    const $at = document.resolve(at);
    expect($at.nodeBefore?.type.name).toBe('columnGroup'); // left cell closes here
    expect($at.nodeAfter?.type.name).toBe('columnGroup'); // right cell opens here
    // And that is the arithmetic the plugin uses.
    const tcPos = 0 + document.child(0).nodeSize; // after 'before'
    const expected = tcPos + 1 + tc.child(0).nodeSize + tc.child(1).nodeSize;
    expect(at).toBe(expected);
  });

  it('gives a nested split its own splitter', () => {
    const inner = twoColumn(cell(para('a')), cell(para('b')));
    const outer = twoColumn(cell(inner), cell(para('R')));
    const decos = columnSplitterDecorations(doc(outer));
    expect(decos).toHaveLength(2);
  });

  it('adds nothing to a document with no split', () => {
    expect(columnSplitterDecorations(doc(para('x'), para('y')))).toHaveLength(0);
  });
});
