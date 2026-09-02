// @vitest-environment jsdom

/**
 * What the selection layer paints. jsdom measures nothing, so every rect the
 * component reads is stubbed and the bands are asserted from the geometry that
 * comes out the other side.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { blockSelectionKey, blockSelectionPlugin } from './block-selection-plugin';
import { coveredBlockRanges } from './delete-selected';
import { SelectionBands } from './SelectionBands';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { schema, registry } = createEditorSchema();

const line = (text?: string): PMNode => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string): PMNode =>
  schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const cell = (text: string, sid: string): PMNode =>
  schema.nodes.tableCell.create({ sid, id: sid }, line(text));
const tableOf = (...cells: PMNode[]): PMNode =>
  schema.nodes.table.create({ columnWidths: [] }, [
    line(),
    schema.nodes.tableRow.create(null, [line(), ...cells]),
  ]);
const column = (sid: string, ...blocks: PMNode[]): PMNode =>
  schema.nodes.columnGroup.create({ sid, id: sid }, [line(), ...blocks]);
const twoColumnOf = (left: PMNode, right: PMNode): PMNode =>
  schema.nodes.twoColumn.create({ sid: 'tc', id: 'tc' }, [line(), left, right]);
const docOf = (...blocks: PMNode[]): PMNode => schema.nodes.doc.create(null, blocks);

function box(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

function posOf(doc: PMNode, sid: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.attrs.sid === sid) found = pos;
    return true;
  });
  return found;
}

let view: EditorView | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

interface PaintedBand {
  readonly left: number;
  readonly width: number;
}

/**
 * Paints `selected` over `doc`, with every top-level row 400 wide and 40 tall,
 * and returns the bands that reached the DOM. `stub` measures anything deeper
 * than a top-level row that the case needs.
 */
function paint(
  doc: PMNode,
  selected: readonly string[],
  stub?: (view: EditorView) => void,
): PaintedBand[] {
  const scroll = document.createElement('div');
  const mount = document.createElement('div');
  scroll.append(mount);
  document.body.appendChild(scroll);
  scroll.getBoundingClientRect = () => box(0, 0, 600, 400);

  view = new EditorView(mount, {
    state: EditorState.create({ schema, doc, plugins: [blockSelectionPlugin(registry)] }),
  });
  view.dom.getBoundingClientRect = () => box(100, 0, 500, 400);
  [...view.dom.children].forEach((child, index) => {
    child.getBoundingClientRect = () => box(100, index * 50, 500, index * 50 + 40);
  });
  stub?.(view);

  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<SelectionBands view={view!} registry={registry} scrollRef={{ current: scroll }} />);
  });
  act(() => {
    view?.dispatch(
      view.state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set(selected), anchorSid: selected[0] ?? null },
      }),
    );
  });

  return [...document.querySelectorAll<HTMLElement>('.notes-selection-band')].map((el) => ({
    left: Number.parseFloat(el.style.left),
    width: Number.parseFloat(el.style.width),
  }));
}

describe('the painted selection', () => {
  it('paints one band over a selected block', () => {
    const doc = docOf(para('before', 'p1'), para('after', 'p2'));
    expect(paint(doc, ['p1']).length).toBe(1);
  });

  it('paints nothing when nothing is selected', () => {
    const doc = docOf(para('before', 'p1'), para('after', 'p2'));
    expect(paint(doc, []).length).toBe(0);
  });
});

describe('the painted selection over a table', () => {
  const doc = (): PMNode => docOf(para('before', 'p1'), tableOf(cell('a', 'c1'), cell('b', 'c2')));

  /**
   * A lone covered cell is a shape only the table's own commands change, so
   * Backspace removes nothing. Lighting the table up would promise otherwise.
   */
  it('paints nothing when the selection covers nothing the delete plan would take', () => {
    expect(coveredBlockRanges(doc(), registry, new Set(['c2']))).toEqual([]);
    expect(paint(doc(), ['c2']).length).toBe(0);
  });

  it('paints the table whole once every cell is covered', () => {
    const bands = paint(doc(), ['c1', 'c2']);
    expect(bands.length).toBe(1);
    expect(bands[0].width).toBeGreaterThanOrEqual(400);
  });
});

describe('the painted selection over a two-column row', () => {
  const doc = (): PMNode =>
    docOf(twoColumnOf(column('colA', para('left', 'sA')), column('colB', para('right', 'sB'))));

  /** Measures the left lane at half the row's width. */
  function stubLeftLane(current: EditorView): void {
    const el = current.nodeDOM(posOf(current.state.doc, 'sA'));
    if (el instanceof HTMLElement) el.getBoundingClientRect = () => box(100, 0, 300, 40);
  }

  it('bands only the selected lane, not the row', () => {
    const bands = paint(doc(), ['sA'], stubLeftLane);
    expect(bands.length).toBe(1);
    // The row is 400 wide; a band claiming the neighbouring lane would be too.
    expect(bands[0].width).toBeLessThan(300);
  });

  it('bands the row whole when both lanes are selected', () => {
    const bands = paint(doc(), ['sA', 'sB'], stubLeftLane);
    expect(bands.length).toBe(1);
    expect(bands[0].width).toBeGreaterThanOrEqual(400);
  });
});
