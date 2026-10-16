// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { editorSchema } from '../schema';
import { measure, resolveBlockDrop, type BlockDragHandle } from './useBlockDrag';

const { schema } = editorSchema();

function fakeView(count: number, top: number, blocks?: PMNode[]) {
  const { paragraph, line, doc } = schema.nodes;
  blocks ??= Array.from({ length: count }, () => paragraph.create({ sid: 'x' }, line.create()));
  const dom = document.createElement('div');
  for (let i = 0; i < count; i++) {
    const child = document.createElement('p');
    child.getBoundingClientRect = () => new DOMRect(100, top + i * 30, 600, 24);
    dom.appendChild(child);
  }
  dom.getBoundingClientRect = () => new DOMRect(100, top, 600, count * 30);
  return { dom, state: { doc: doc.create(null, blocks) } } as unknown as EditorView;
}

describe('measure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('measures nothing when the pointer falls on the root and every block is off screen', () => {
    const view = fakeView(40, 5000);
    document.elementFromPoint = () => view.dom;
    expect(measure(view, 100)).toEqual({ rows: [], splitRows: [], left: 0, width: 0 });
  });

  it('measures the blocks near the viewport', () => {
    const view = fakeView(3, 100);
    document.elementFromPoint = () => view.dom.children[1];
    const measured = measure(view, 130);
    expect(measured.rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(measured.splitRows.map((r) => r.pos)).toEqual([0, 4, 8]);
    expect(measured.width).toBe(600);
  });
});

describe('resolveBlockDrop with a nested block', () => {
  const { paragraph, line, bulletItem } = schema.nodes;
  const doc = [
    paragraph.create({ sid: 'a' }, line.create()),
    bulletItem.create({ sid: 'parent' }, [line.create(), bulletItem.create({ sid: 'child' }, line.create())]),
    paragraph.create({ sid: 'c' }, line.create()),
  ];
  // The child's grip sits at x=124, inside the 60 px left band of the 600 px wide rows at x=100.
  const PRESS_X = 124;

  function setup() {
    const view = fakeView(3, 100, doc);
    document.elementFromPoint = () => view.dom.children[2];
    let childPos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.attrs.sid === 'child') childPos = pos;
    });
    const handle: BlockDragHandle = { index: null, pos: childPos, sid: 'child', label: 'Bullet' };
    const lastRow = view.dom.children[2].getBoundingClientRect();
    return { view, handle, y: lastRow.top + 2 };
  }

  it('lands in a page gap on a straight vertical drag', () => {
    const { view, handle, y } = setup();
    const target = resolveBlockDrop(view, { x: PRESS_X, y }, handle, PRESS_X, { current: null });
    expect(target?.kind).toBe('gap');
  });

  it('splits once the pointer moves sideways into the band', () => {
    const { view, handle, y } = setup();
    const target = resolveBlockDrop(view, { x: PRESS_X + 30, y }, handle, PRESS_X, { current: null });
    expect(target?.kind).toBe('split');
  });
});
