// @vitest-environment jsdom

/**
 * That the chrome can be reached.
 *
 * The handles and the rails are drawn *outside* the table's own box, so which
 * element the pointer is tracked on is a correctness property and not a detail:
 * tracked on the frame, `pointerleave` fires in the few pixels between the last
 * cell and the handle, and the handle fades and goes click-through before you
 * arrive. It shipped that way once. A pointer event dispatched on the padded box
 * does not reach a listener on the frame, so these tests fail if the listeners
 * move back.
 *
 * jsdom lays nothing out, so the cells' sizes are stubbed. That is enough: the
 * geometry itself is pinned separately as a pure function, and what is being
 * proved here is which element answers.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import type { Block } from '../../model/types';
import { plainSpan } from '../../model/spans';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import { NodeViewPortals } from '../view/NodeViewPortal';
import { createPortalRegistry, type PortalRegistry } from '../view/portal-registry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

/** The stubbed cell size, so the measured grid is not all zeros. */
const CELL_W = 160;
const CELL_H = 40;

function stubLayout(): () => void {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const cellOnly = (value: number) => ({
    configurable: true,
    get(this: HTMLElement): number {
      return this.hasAttribute('data-table-cell') ? value : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', cellOnly(CELL_W));
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', cellOnly(CELL_H));
  return () => {
    if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
    if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
  };
}

function block(type: Block['type'], text: string, extra: Partial<Block> = {}): Block {
  return {
    id: `${type}-${text}`,
    sid: '',
    type,
    spans: [plainSpan(text)],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...extra,
  };
}

const tableBlock = (): Block =>
  block('Table', '', {
    payload: {
      kind: 'table',
      columnWidths: [CELL_W, CELL_W],
      headerRow: false,
      headerCol: false,
      fullWidth: false,
    },
    children: [0, 1].map((r) =>
      block('TableRow', '', {
        id: `row-${r}`,
        children: [0, 1].map((c) =>
          block('TableCell', `${r}:${c}`, {
            id: `cell-${r}-${c}`,
            payload: { kind: 'tableCell', fill: '' },
          }),
        ),
      }),
    ),
  });

interface Harness {
  view: EditorView;
  root: Root;
  registry: PortalRegistry;
  mount: HTMLElement;
  host: HTMLElement;
  restore: () => void;
}

let harness: Harness | null = null;

function open(): Harness {
  const restore = stubLayout();
  const state = buildNoteEditState([tableBlock()]);
  if (!state.ok) throw new Error('the fixture must load');

  const registry = createPortalRegistry();
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const view = new EditorView(mount, {
    state: state.state,
    nodeViews: toNodeViews(state.registry, resolveServices({ portals: registry })),
    editable: () => true,
  });

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<NodeViewPortals registry={registry} />));

  harness = { view, root, registry, mount, host, restore };
  return harness;
}

function scrollBox(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.notes-table-scroll');
  if (!element) throw new Error('the table did not render its scroll box');
  return element;
}

/** The two handle slots, column first, as the view appends them. */
function slots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.notes-table-handle-slot'));
}

function rails(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.notes-table-rail'));
}

/** A pointer move over the *padded box*, which is where the chrome hangs. */
function movePointer(x: number, y: number): void {
  act(() => {
    scrollBox().dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }),
    );
  });
}

afterEach(() => {
  if (!harness) return;
  const { view, root, mount, host, restore } = harness;
  act(() => root.unmount());
  view.destroy();
  mount.remove();
  host.remove();
  restore();
  harness = null;
});

beforeEach(() => {
  open();
});

describe('the table chrome', () => {
  it('mounts inside the frame, where the overlays can be positioned against it', () => {
    const frame = document.querySelector('.notes-table-frame')!;
    const chrome = document.querySelector('.notes-table-chrome')!;
    expect(chrome.parentElement).toBe(frame);
  });

  it('offers the row handle while the pointer is out in the left margin', () => {
    // The gesture the shipped bug broke: the handle is at x = -17, so reaching it
    // means leaving the table's own box.
    movePointer(-11, 20);
    const [, row] = slots();
    expect(row.style.opacity).toBe('1');
    expect(row.style.pointerEvents).toBe('auto');
  });

  it('offers the column handle while the pointer is out above the first row', () => {
    movePointer(40, -11);
    const [col] = slots();
    expect(col.style.opacity).toBe('1');
    expect(col.style.pointerEvents).toBe('auto');
  });

  it('offers the add-row rail below the last row and keeps it while travelling to it', () => {
    const bottom = 2 * CELL_H;
    movePointer(40, bottom - 5);
    const railBefore = rails().find((rail) => rail.style.height === '14px')!;
    expect(railBefore.style.opacity).toBe('1');
    // Past the table's own edge, in the padding the rail is drawn in.
    movePointer(40, bottom + 10);
    expect(rails().find((rail) => rail.style.height === '14px')!.style.opacity).toBe('1');
  });

  it('offers the add-column rail beside the last column', () => {
    movePointer(2 * CELL_W + 8, 20);
    expect(rails().find((rail) => rail.style.width === '14px')!.style.opacity).toBe('1');
  });

  it('takes the chrome away once the pointer leaves the padded box entirely', () => {
    movePointer(40, 20);
    expect(slots()[0].style.opacity).toBe('1');
    act(() => {
      scrollBox().dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerId: 1, isPrimary: true }));
    });
    for (const slot of slots()) expect(slot.style.opacity).toBe('0');
  });

  it('draws a resize strip per column boundary', () => {
    movePointer(40, 20);
    expect(document.querySelectorAll('.notes-table-resize')).toHaveLength(2);
  });
});
