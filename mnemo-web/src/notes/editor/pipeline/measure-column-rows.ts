/**
 * The two-column layouts on screen, measured for the column drop resolver.
 *
 * Only layouts inside a run of top-level blocks are read, the blocks the reorder
 * has already found near the viewport, so the cost follows what is on screen
 * rather than the size of the note. A layout nested in a cell is measured as a
 * row of its own at the next depth. Every rect comes from the node's own
 * element through `nodeDOM`, which is the layout the CSS produced, splitter
 * widget and all.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { lineOf } from '../blocks/shared';
import type { BlockRow } from './resolve-block-reorder';
import type { ColumnRow, Lane } from './resolve-column-drop';

/** Every layout inside the top-level blocks `firstIndex` through `lastIndex`, outermost first. */
export function measureColumnRows(view: EditorView, firstIndex: number, lastIndex: number): ColumnRow[] {
  const doc = view.state.doc;
  const out: ColumnRow[] = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount && i <= lastIndex; i++) {
    const node = doc.child(i);
    if (i >= firstIndex) collectLayouts(view, node, pos, 0, out);
    pos += node.nodeSize;
  }
  return out;
}

function collectLayouts(view: EditorView, node: PMNode, pos: number, depth: number, out: ColumnRow[]): void {
  let inside = depth;
  if (node.type.name === 'twoColumn') {
    const row = measureLayout(view, node, pos, depth);
    if (row) out.push(row);
    inside = depth + 1;
  }
  const line = lineOf(node);
  node.forEach((child, offset) => {
    if (child === line) return;
    collectLayouts(view, child, pos + 1 + offset, inside, out);
  });
}

function measureLayout(view: EditorView, node: PMNode, pos: number, depth: number): ColumnRow | null {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();

  const lanes: Lane[] = [];
  node.forEach((child, offset) => {
    if (child.type.name !== 'columnGroup') return;
    const lane = measureLane(view, child, pos + 1 + offset);
    if (lane) lanes.push(lane);
  });
  if (lanes.length === 0) return null;

  return { pos, depth, top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, lanes };
}

function measureLane(view: EditorView, cell: PMNode, cellPos: number): Lane | null {
  const dom = view.nodeDOM(cellPos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();

  const line = lineOf(cell);
  const rows: BlockRow[] = [];
  let blockCount = 0;
  cell.forEach((child, offset) => {
    if (child === line) return;
    const index = blockCount;
    blockCount += 1;
    const childDom = view.nodeDOM(cellPos + 1 + offset);
    if (!(childDom instanceof HTMLElement)) return;
    const childRect = childDom.getBoundingClientRect();
    rows.push({ index, top: childRect.top, bottom: childRect.bottom });
  });

  return {
    cellPos,
    cellSid: String(cell.attrs.sid ?? ''),
    blockCount,
    left: rect.left,
    width: rect.width,
    rows,
  };
}
