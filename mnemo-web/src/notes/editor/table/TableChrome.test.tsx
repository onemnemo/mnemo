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
 *
 * The assertions read `data-shown` rather than a computed opacity. That attribute
 * *is* the state ("this chrome is being reached for"); the fade is the
 * stylesheet's, and asserting on paint jsdom never performs would only pin the
 * test to the implementation that happened to set an inline style.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import type { Block } from '../../model/types';
import { plainSpan } from '../../model/spans';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import { NodeViewPortals } from '../view/NodeViewPortal';
import { createPortalRegistry, type PortalRegistry } from '../view/portal-registry';
import { cellAtPos, cellCaretPos } from './model';

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
      headerRows: [],
      headerColumns: [],
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
    expect(row.hasAttribute('data-shown')).toBe(true);
  });

  it('offers the column handle while the pointer is out above the first row', () => {
    movePointer(40, -11);
    const [col] = slots();
    expect(col.hasAttribute('data-shown')).toBe(true);
  });

  it('offers the add-row rail below the last row and keeps it while travelling to it', () => {
    const bottom = 2 * CELL_H;
    movePointer(40, bottom - 5);
    const railBefore = rails().find((rail) => rail.style.height === '14px')!;
    expect(railBefore.hasAttribute('data-shown')).toBe(true);
    // Past the table's own edge, in the padding the rail is drawn in.
    movePointer(40, bottom + 10);
    expect(rails().find((rail) => rail.style.height === '14px')!.hasAttribute('data-shown')).toBe(true);
  });

  it('offers the add-column rail beside the last column', () => {
    movePointer(2 * CELL_W + 8, 20);
    expect(rails().find((rail) => rail.style.width === '14px')!.hasAttribute('data-shown')).toBe(true);
  });

  it('takes the chrome away once the pointer leaves the padded box entirely', () => {
    movePointer(40, 20);
    expect(slots()[0].hasAttribute('data-shown')).toBe(true);
    act(() => {
      scrollBox().dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerId: 1, isPrimary: true }));
    });
    for (const slot of slots()) expect(slot.hasAttribute('data-shown')).toBe(false);
  });

  it('draws a resize strip per column boundary', () => {
    movePointer(40, 20);
    expect(document.querySelectorAll('.notes-table-resize')).toHaveLength(2);
  });

  /**
   * The strips lie across the table on top of the cells, so one that is not being
   * reached for has to be out of the way of the text under it. It shipped in the
   * way: the strips said so with a utility class, and the chrome layer's own rules
   * sit at a higher specificity, so every column boundary swallowed presses meant
   * for the caret.
   *
   * Only the state is testable here. Whether the stylesheet then honours it is a
   * question about paint, and jsdom does not paint; that half is checked by
   * hit-testing the running app.
   */
  it('marks a resize strip live only when its boundary is being reached for', () => {
    const strips = () => Array.from(document.querySelectorAll<HTMLElement>('.notes-table-resize'));
    // Pointer in the first column: its own two boundaries answer, and only those.
    movePointer(40, 20);
    expect(strips().map((strip) => strip.hasAttribute('data-live'))).toEqual([true, false]);

    // Pointer in the second column.
    movePointer(CELL_W + 40, 20);
    expect(strips().map((strip) => strip.hasAttribute('data-live'))).toEqual([true, true]);

    // Pointer off the table entirely: nothing is in the way.
    act(() => {
      scrollBox().dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerId: 1, isPrimary: true }));
    });
    expect(strips().map((strip) => strip.hasAttribute('data-live'))).toEqual([false, false]);
  });
});

/**
 * Every key the table owns, dispatched where the browser dispatches it.
 *
 * The caret lives in ProseMirror's contentEditable root, so a keystroke fires
 * there and the table's frame, being a descendant, never sees it. Bound to the
 * frame, the whole table keymap was dead in the running editor and ProseMirror's
 * fallback walked the cells in document order, so the up arrow moved one cell
 * left and the down arrow one cell right.
 *
 * These dispatch on `view.dom` on purpose. Dispatching on the frame is what made
 * the original tests pass against code that did not work.
 */
describe('the table keymap', () => {
  /** Where the caret is, as a cell index, or null if it left the table. */
  function caretCellIndex(): { row: number; col: number } | null {
    const { view } = harness!;
    const table = view.state.doc.firstChild!;
    return cellAtPos(table, 0, view.state.selection.from);
  }

  function putCaret(row: number, col: number, edge: 'start' | 'end' = 'start'): void {
    const { view } = harness!;
    const at = cellCaretPos(view.state.doc.firstChild!, 0, row, col, edge)!;
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    });
  }

  /** The cell the black outline is drawn over, from the band's own geometry. */
  function outlinedCell(): { row: number; col: number } | null {
    const band = document.querySelector<HTMLElement>('.notes-table-band');
    if (!band) return null;
    return {
      row: Math.round(parseFloat(band.style.top) / CELL_H),
      col: Math.round(parseFloat(band.style.left) / CELL_W),
    };
  }

  /** A keystroke as the browser delivers it: on the element holding the caret. */
  function press(key: string, init: KeyboardEventInit = {}): boolean {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init });
    act(() => {
      harness!.view.dom.dispatchEvent(event);
    });
    return event.defaultPrevented;
  }

  it('moves the caret down a column, not along the row', () => {
    putCaret(0, 1);
    expect(press('ArrowDown')).toBe(true);
    expect(caretCellIndex()).toEqual({ row: 1, col: 1 });
  });

  it('moves the caret up a column, not along the row', () => {
    putCaret(1, 1);
    expect(press('ArrowUp')).toBe(true);
    expect(caretCellIndex()).toEqual({ row: 0, col: 1 });
  });

  it('leaves a shift arrow to ProseMirror, which extends the selection within the cell', () => {
    putCaret(0, 1);
    // The table never claims a shift arrow; the caret's cell is unchanged.
    expect(press('ArrowDown', { shiftKey: true })).toBe(false);
    expect(press('ArrowUp', { shiftKey: true })).toBe(false);
    expect(caretCellIndex()).toEqual({ row: 0, col: 1 });
  });

  it('leaves the arrows alone at the edges, so the caret can get out of the table', () => {
    putCaret(0, 0);
    expect(press('ArrowUp')).toBe(false);
    expect(press('ArrowLeft')).toBe(false);
    putCaret(1, 1, 'end');
    expect(press('ArrowRight')).toBe(false);
  });

  /**
   * The sideways pair shipped unhandled, so ProseMirror moved the caret across the
   * cell boundary on its own and the black cell stayed where it was. Both halves
   * are asserted: where the caret went, and where the outline went.
   */
  it('moves the caret and the outline along the row on the right arrow', () => {
    putCaret(0, 0, 'end');
    expect(press('ArrowRight')).toBe(true);
    expect(caretCellIndex()).toEqual({ row: 0, col: 1 });
    expect(outlinedCell()).toEqual({ row: 0, col: 1 });
  });

  it('moves the caret and the outline back along the row on the left arrow', () => {
    putCaret(0, 1);
    expect(press('ArrowLeft')).toBe(true);
    expect(caretCellIndex()).toEqual({ row: 0, col: 0 });
    expect(outlinedCell()).toEqual({ row: 0, col: 0 });
  });

  /**
   * Entering from the right has to land on the right. Landing at the start would
   * mean the next left arrow left the table, skipping the text it was walking
   * towards.
   */
  it('lands on the far side of the cell it entered', () => {
    putCaret(1, 1);
    press('ArrowLeft');
    const { view } = harness!;
    const cell = cellCaretPos(view.state.doc.firstChild!, 0, 1, 0, 'end');
    expect(view.state.selection.from).toBe(cell);
  });

  it('wraps the sideways arrows onto the next row and the previous one', () => {
    putCaret(0, 1, 'end');
    expect(press('ArrowRight')).toBe(true);
    expect(caretCellIndex()).toEqual({ row: 1, col: 0 });
    expect(press('ArrowLeft')).toBe(true);
    expect(caretCellIndex()).toEqual({ row: 0, col: 1 });
  });

  /**
   * Every table in the note is asked about every keystroke, because the only gate
   * a document-level listener can apply is "the event came from an editor holding
   * this table". A row left selected therefore went on owning Backspace after the
   * caret had moved to another block: pressing it there wiped the row instead of
   * deleting a character, and Escape was swallowed the same way.
   */
  it('gives up its keys, and its paint, once the caret is in another block', () => {
    const { view } = harness!;
    // A row selected the way the grip selects one, then the caret moved out.
    const rowHandle = slots()[1].querySelector<HTMLElement>('.notes-table-handle')!;
    act(() => {
      rowHandle.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1, isPrimary: true }),
      );
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true }));
    });
    expect(outlinedCell()).not.toBeNull();

    const before = view.state.doc.toString();
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)));
    });
    expect(press('Backspace')).toBe(false);
    expect(view.state.doc.toString()).toBe(before);
    expect(outlinedCell()).toBeNull();
  });

  /**
   * The other half of that: a run selected from cold still has to answer, so
   * pressing the grip puts the document's caret in the run as well as painting it.
   */
  it('clears the selected row on Backspace when the grip is the only thing that selected it', () => {
    const { view } = harness!;
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)));
    });
    const rowHandle = slots()[1].querySelector<HTMLElement>('.notes-table-handle')!;
    act(() => {
      rowHandle.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1, isPrimary: true }),
      );
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true }));
    });
    expect(press('Backspace')).toBe(true);
    expect(view.state.doc.textBetween(0, view.state.doc.content.size, ' ')).not.toContain('0:0');
    // The row below it is untouched.
    expect(view.state.doc.textBetween(0, view.state.doc.content.size, ' ')).toContain('1:0');
  });

  /** Selects a row through its grip, the way a user reaches the row menu. */
  function selectRowViaGrip(): void {
    const rowHandle = slots()[1].querySelector<HTMLElement>('.notes-table-handle')!;
    act(() => {
      rowHandle.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1, isPrimary: true }),
      );
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true }));
    });
  }

  /**
   * The menu-breaking regression, pinned. The table's menus are portalled to the
   * body, so a press on a menu item is not inside the editor root. Dropping the
   * selection on such a press swapped the cell menu to its table-settings fallback
   * between pointerdown and click, and every item released on the wrong row.
   */
  it('keeps its selection when a press lands outside the editor, the way a menu does', () => {
    selectRowViaGrip();
    expect(outlinedCell()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, isPrimary: true }),
      );
    });
    expect(outlinedCell()).not.toBeNull();
  });

  it('drops its selection when a press lands elsewhere in the document', () => {
    selectRowViaGrip();
    expect(outlinedCell()).not.toBeNull();
    act(() => {
      harness!.view.dom.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, isPrimary: true }),
      );
    });
    expect(outlinedCell()).toBeNull();
  });

  it('walks the cells on Tab and back on Shift+Tab', () => {
    putCaret(0, 0);
    expect(press('Tab')).toBe(true);
    expect(caretCellIndex()).toEqual({ row: 0, col: 1 });
    expect(press('Tab', { shiftKey: true })).toBe(true);
    expect(caretCellIndex()).toEqual({ row: 0, col: 0 });
  });

  it('wraps Tab onto the next row', () => {
    putCaret(0, 1);
    expect(press('Tab')).toBe(true);
    expect(caretCellIndex()).toEqual({ row: 1, col: 0 });
  });

  it('ignores keys belonging to another editor', () => {
    putCaret(0, 0);
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' });
    act(() => {
      elsewhere.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(caretCellIndex()).toEqual({ row: 0, col: 0 });
    elsewhere.remove();
  });
});

/**
 * The context-menu key is the only route a keyboard has to any of the cell or
 * table verbs, and it cannot share the right-click's listener: a press bubbles up
 * from a cell, while the key targets whatever holds focus, which is the editor's
 * root and therefore an *ancestor* of the table. The two tests below are the two
 * halves of getting that discrimination right.
 */
describe('the context-menu key', () => {
  /** Puts the caret in a cell the way a keyboard would, then presses the key. */
  function pressMenuKey(row: number, col: number, target?: Element): void {
    const { view } = harness!;
    const table = view.state.doc.firstChild!;
    const at = cellCaretPos(table, 0, row, col)!;
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    });
    act(() => {
      (target ?? view.dom).dispatchEvent(
        // No useful coordinates: that is what this key sends.
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }),
      );
    });
  }

  it('selects the caretic cell and anchors the menu under it', () => {
    pressMenuKey(1, 1);
    const band = document.querySelector<HTMLElement>('.notes-table-band');
    expect(band).not.toBeNull();
    // The cell the caret is in, not the coordinates on the event.
    expect(band!.style.left).toBe(`${CELL_W}px`);
    expect(band!.style.top).toBe(`${CELL_H}px`);
  });

  it('ignores the key when it belongs to something outside this table', () => {
    // An element that neither contains the table nor sits inside it. A press in
    // another block while the caret happens to be in a cell must not answer about
    // the table.
    const elsewhere = document.createElement('div');
    document.body.appendChild(elsewhere);
    pressMenuKey(0, 0, elsewhere);
    expect(document.querySelector('.notes-table-band')).toBeNull();
    elsewhere.remove();
  });
});
