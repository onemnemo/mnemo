// @vitest-environment jsdom

/**
 * The gutter chrome: where its row lands, and what keeps it on screen.
 *
 * jsdom lays nothing out, so every rect it reports is zero and no mounted check
 * can say anything about pixels. The placement is therefore pinned as a pure
 * function, which is where the arithmetic lives, and the mounted half covers
 * what a layout-free DOM can still prove: which block the row is offered on,
 * that every block gets the same row, and that it survives the two things that
 * used to take it away, the block changing under it and the pointer leaving
 * while its menu is open.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import type { BlockRegistry } from '../registry/build';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import { BlockGutter } from './BlockGutter';
import { chromeRowGeometry, chromeRowTop } from './chrome-row';
import { setCalloutEmoji } from './callout-icon';
import { calloutIconRequest, closeCalloutIcon } from './callout-icon-request';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The document column pads itself by this much, and the chrome is drawn in that
 * padding. Restated here rather than imported: the point of the test is that the
 * row respects a margin of a known size, and a shared constant would move both
 * sides of the assertion at once.
 */
const MARGIN = 56;

describe('chromeRowGeometry', () => {
  it('sits the row in the margin, clear of the text and inside the pane', () => {
    const row = chromeRowGeometry({ blockLeft: 100, rootLeft: 100 });
    expect(row.left + row.width).toBeLessThan(100);
    // Past this it would be drawn outside the pane, over the split divider or
    // over the window edge, depending on which side of the split this pane is.
    expect(row.left).toBeGreaterThanOrEqual(100 - MARGIN);
    // Nothing under it but the page's own margin, so it stays transparent.
    expect(row.overContent).toBe(false);
  });

  it('goes opaque when the row reaches into the document column', () => {
    // A block in the right-hand cell of a two-column row has no margin of its
    // own, so its row is drawn over the left cell's text.
    expect(chromeRowGeometry({ blockLeft: 400, rootLeft: 100 }).overContent).toBe(true);
  });

  it('keeps the row at one distance from the block, wherever the block starts', () => {
    const near = chromeRowGeometry({ blockLeft: 260, rootLeft: 100 });
    const far = chromeRowGeometry({ blockLeft: 400, rootLeft: 100 });
    expect(260 - (near.left + near.width)).toBe(400 - (far.left + far.width));
  });

  it('takes the page margin as the lane of a block given none', () => {
    expect(chromeRowGeometry({ blockLeft: 260, rootLeft: 100 })).toEqual(
      chromeRowGeometry({ blockLeft: 260, rootLeft: 100, laneLeft: 100 - MARGIN }),
    );
  });

  it('gives a first cell the same row a top-level block gets', () => {
    // A first cell starts where the document does, so a block in it reaches the
    // page's own margin and nothing about its row is a column's business.
    const cell = chromeRowGeometry({ blockLeft: 100, rootLeft: 100, laneLeft: 100 - MARGIN });
    expect(cell).toEqual(chromeRowGeometry({ blockLeft: 100, rootLeft: 100 }));
    expect(cell.stacked).toBe(false);
  });

  it('keeps the wide row where a later cell leaves room for it', () => {
    const row = chromeRowGeometry({ blockLeft: 460, rootLeft: 100, laneLeft: 400 });
    expect(row.stacked).toBe(false);
    expect(row.left).toBe(414);
    expect(row.width).toBe(42);
    expect(row.overContent).toBe(true);
  });

  it('stacks the buttons where a later cell leaves only a splitter', () => {
    // The measured layout: a 665px column at 549, split evenly, the left cell's
    // text ending at 873.5 and the right cell's starting a 16px splitter later.
    const row = chromeRowGeometry({ blockLeft: 889.5, rootLeft: 549, laneLeft: 873.5 });
    expect(row.stacked).toBe(true);
    expect(row.width).toBe(22);
    expect(row.height).toBe(44);
    expect(row.left).toBe(863.5);
    // Twelve pixels of splitter and ten of the neighbour's text, against the
    // thirty the wide row would have taken out of that text.
    expect(873.5 - row.left).toBe(10);
    // Nowhere for it to sit but on someone else's prose, so it is never bare.
    expect(row.overContent).toBe(true);
  });

  it('stacks exactly when the wide row would cross out of the lane', () => {
    const exact = chromeRowGeometry({ blockLeft: 146, rootLeft: 100, laneLeft: 100 });
    expect(exact.stacked).toBe(false);
    expect(exact.left).toBe(100);
    expect(chromeRowGeometry({ blockLeft: 145, rootLeft: 100, laneLeft: 100 }).stacked).toBe(true);
  });

  it('holds either variant the same distance off the block, the stack reaching less far', () => {
    const wide = chromeRowGeometry({ blockLeft: 460, rootLeft: 100, laneLeft: 400 });
    const stacked = chromeRowGeometry({ blockLeft: 460, rootLeft: 100, laneLeft: 450 });
    expect(stacked.stacked).toBe(true);
    expect(460 - (wide.left + wide.width)).toBe(460 - (stacked.left + stacked.width));
    expect(stacked.left).toBeGreaterThan(wide.left);
  });
});

describe('chromeRowTop', () => {
  /** A note scrolling between a topbar at 48 and the window's bottom at 800. */
  const note = { rowHeight: 28, clipTop: 48, clipBottom: 800 };

  it('sits on the block while the block is inside the note', () => {
    expect(chromeRowTop({ ...note, blockTop: 300, blockBottom: 340 })).toBe(300);
  });

  it('holds the row inside the note while a tall block runs off the top', () => {
    // The block still fills the visible area, so its row has to stay reachable
    // rather than travel up over the topbar with the block's own edge.
    expect(chromeRowTop({ ...note, blockTop: -400, blockBottom: 600 })).toBe(48);
  });

  it('holds the row inside the note at the bottom edge', () => {
    expect(chromeRowTop({ ...note, blockTop: 790, blockBottom: 830 })).toBe(772);
  });

  it('drops the row once the block has left the note', () => {
    expect(chromeRowTop({ ...note, blockTop: -90, blockBottom: -50 })).toBeNull();
    expect(chromeRowTop({ ...note, blockTop: 810, blockBottom: 860 })).toBeNull();
  });

  it('clips nothing against a container that measures less than one row', () => {
    expect(chromeRowTop({ rowHeight: 28, clipTop: 0, clipBottom: 0, blockTop: 300, blockBottom: 340 })).toBe(300);
  });
});

type Blocks = Parameters<typeof buildNoteEditState>[0];

interface Mounted {
  view: EditorView;
  registry: BlockRegistry;
  /** The chrome's own tree, which is where the row is rendered. */
  chrome: HTMLElement;
}

let root: Root | null = null;
let mounted: Mounted | null = null;

function mount(blocks: Blocks): Mounted {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  const host = document.createElement('div');
  document.body.appendChild(host);
  // With the block views the editor really mounts: a block that draws its own
  // chrome keeps its element across an attr write, which is the difference the
  // chrome has to survive.
  const view = new EditorView(host, {
    state: built.state,
    nodeViews: toNodeViews(built.registry, resolveServices()),
  });

  const chrome = document.createElement('div');
  document.body.appendChild(chrome);
  root = createRoot(chrome);
  act(() => root?.render(<BlockGutter view={view} registry={built.registry} scrollRef={{ current: host }} />));

  mounted = { view, registry: built.registry, chrome };
  return mounted;
}

beforeEach(() => {
  vi.useFakeTimers();
  closeCalloutIcon();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  mounted?.view.destroy();
  mounted = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

/**
 * Put the pointer on a block. Every rect jsdom reports is zero, so the editor's
 * own box is the single point (0, 0) and that is the only coordinate inside the
 * hover band; the element under the pointer is the event's target either way.
 */
function hoverAt(target: Element, x: number, y: number): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
  });
}

function hover(target: Element): void {
  hoverAt(target, 0, 0);
}

/** Take the pointer off the document entirely and let the hover-clear run. */
function leave(): void {
  act(() => {
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 500, clientY: 500 }));
    vi.advanceTimersByTime(300);
  });
}

/** A scroll is the everyday reason the chrome re-derives itself. */
function remeasure(): void {
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

function click(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** The chrome's buttons, in the order they are drawn. */
function buttons(): string[] {
  const chrome = mounted?.chrome;
  if (!chrome) return [];
  return [...chrome.querySelectorAll('button')].map((el) => el.getAttribute('aria-label') ?? '');
}

/** The top-level block element at `index`, which is what the pointer lands on. */
function blockElement(index: number): HTMLElement {
  const el = mounted?.view.dom.children[index];
  if (!(el instanceof HTMLElement)) throw new Error('no block element');
  return el;
}

const calloutNote: Blocks = [
  block('Callout', [span('remember')], { kind: 'callout', emoji: '💡', tone: 'info' }),
  block('Text', [span('after')]),
];

const columnNote: Blocks = [
  block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
    children: [
      block('ColumnGroup', [span('')], { kind: 'empty' }, {
        children: [block('Text', [span('left cell')])],
      }),
      block('ColumnGroup', [span('')], { kind: 'empty' }, {
        children: [block('Text', [span('right cell')])],
      }),
    ],
  }),
];

/**
 * The measured layout of an even two-column split, restated as rects because
 * jsdom produces none: a 665px content column at 549, cells 324.5 wide, and the
 * 16px splitter between the left cell's text and the right cell's.
 */
const ROOT_LEFT = 549;
const COLUMN_WIDTH = 665;
const CELL_WIDTH = 324.5;
const SPLITTER_WIDTH = 16;
const RIGHT_CELL_LEFT = ROOT_LEFT + CELL_WIDTH + SPLITTER_WIDTH;

function fakeRect(el: Element, x: number, y: number, width: number, height: number): void {
  el.getBoundingClientRect = () => new DOMRect(x, y, width, height);
}

interface FakeColumns {
  splitter: HTMLElement;
  leftBlock: HTMLElement;
  rightBlock: HTMLElement;
}

/** Write the measured layout onto the four elements the chrome reads a rect from. */
function layOutColumns(view: EditorView): FakeColumns {
  const cells = [...view.dom.querySelectorAll<HTMLElement>('[data-column]')];
  const splitter = view.dom.querySelector<HTMLElement>('.notes-column-splitter');
  const [leftCell, rightCell] = cells;
  const leftBlock = leftCell?.lastElementChild;
  const rightBlock = rightCell?.lastElementChild;
  if (
    !splitter ||
    !leftCell ||
    !rightCell ||
    !(leftBlock instanceof HTMLElement) ||
    !(rightBlock instanceof HTMLElement)
  ) {
    throw new Error('the two-column fixture did not render');
  }
  fakeRect(view.dom, ROOT_LEFT, 0, COLUMN_WIDTH, 800);
  fakeRect(leftCell, ROOT_LEFT, 0, CELL_WIDTH, 200);
  fakeRect(rightCell, RIGHT_CELL_LEFT, 0, CELL_WIDTH, 200);
  fakeRect(leftBlock, ROOT_LEFT, 0, CELL_WIDTH, 24);
  fakeRect(rightBlock, RIGHT_CELL_LEFT, 100, CELL_WIDTH, 24);
  return { splitter, leftBlock, rightBlock };
}

/** Where the row is drawn, which is the one thing that says which block it is on. */
function rowBox(): Record<string, string> {
  const el = mounted?.chrome.querySelector('[data-block-gutter]');
  if (!(el instanceof HTMLElement)) throw new Error('no chrome row');
  return { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
}

/** The row beside the right cell's block, stacked into the splitter lane. */
const STACKED = { left: '863.5px', top: '100px', width: '22px', height: '44px' };

describe('BlockGutter', () => {
  it('offers a callout the same row as any other block', () => {
    mount(calloutNote);
    hover(blockElement(0));
    // The glyph is pressed in the document, so the callout earns no button of
    // its own here and the two the reader aims for never move.
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
    hover(blockElement(1));
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
  });

  it('keeps its buttons out of Tab order, so typing and pressing Tab never lands here', () => {
    mount(calloutNote);
    hover(blockElement(0));
    const els = mounted?.chrome.querySelectorAll('button') ?? [];
    expect(els.length).toBeGreaterThan(0);
    for (const el of els) expect(el.tabIndex).toBe(-1);
  });

  it('stays on the callout across a glyph change', () => {
    const { view, registry } = mount(calloutNote);
    hover(blockElement(0));
    const before = blockElement(0);

    act(() => {
      setCalloutEmoji(view, registry, { pos: 0, sid: String(view.state.doc.child(0).attrs.sid) }, '🚀');
    });
    // The callout's own view writes the glyph in place, so the element the
    // chrome is following survives the write. A block rebuilt instead is what
    // used to end with the row vanishing under the pointer.
    expect(before.isConnected).toBe(true);

    remeasure();
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
  });

  it('lets go of the block when the pointer leaves', () => {
    mount(calloutNote);
    hover(blockElement(0));
    leave();
    expect(buttons()).toEqual([]);
  });

  it('holds the chrome on its block while the block menu is open', () => {
    mount(calloutNote);
    hover(blockElement(1));
    const grip = [...(mounted?.chrome.querySelectorAll('button') ?? [])].at(-1);
    if (!grip) throw new Error('no grip');
    click(grip);
    expect(grip.getAttribute('aria-expanded')).toBe('true');

    leave();
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
  });

  it('hands the glyph row on to the picker, and leaves the focus to it', () => {
    const { view } = mount(calloutNote);
    hover(blockElement(0));
    const grip = [...(mounted?.chrome.querySelectorAll('button') ?? [])].at(-1);
    if (!grip) throw new Error('no grip');
    click(grip);

    const row = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === 'CalloutIcon',
    );
    if (!row) throw new Error('no glyph row');
    click(row);
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(calloutIconRequest()).toEqual({ pos: 0, sid: String(view.state.doc.child(0).attrs.sid) });
    // The grip normally takes the focus back when its menu closes, which would
    // dismiss the picker the row just asked for.
    expect(document.activeElement).not.toBe(grip);
  });

  it('stacks the row into the splitter lane beside a later cell', () => {
    const { view } = mount(columnNote);
    const columns = layOutColumns(view);
    hoverAt(columns.rightBlock, 900, 110);
    expect(rowBox()).toEqual(STACKED);
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
  });

  it('keeps the row on its block while the pointer is on the splitter', () => {
    const { view } = mount(columnNote);
    const columns = layOutColumns(view);
    hoverAt(columns.rightBlock, 900, 110);
    // Far below the block, so nothing but the splitter rule can hold the row:
    // the splitter is drawn by the view, and resolving it answered with the
    // *left* cell's first block, which threw the row to the other side.
    hoverAt(columns.splitter, 881, 400);
    expect(rowBox()).toEqual(STACKED);
  });

  it('keeps the row on its block while the pointer crosses to it', () => {
    const { view } = mount(columnNote);
    const columns = layOutColumns(view);
    hoverAt(columns.rightBlock, 900, 110);
    // Beside the row, on the left cell's text: the row is being reached for, so
    // it must not move to whatever the pointer passes over on the way.
    hoverAt(columns.leftBlock, 870, 112);
    expect(rowBox()).toEqual(STACKED);
  });

  it('offers the neighbour again the moment the pointer leaves the crossing', () => {
    const { view } = mount(columnNote);
    const columns = layOutColumns(view);
    hoverAt(columns.rightBlock, 900, 110);
    hoverAt(columns.leftBlock, 700, 400);
    // The first cell reaches the page's own margin, so its row is the wide one.
    expect(rowBox()).toEqual({ left: '503px', top: '0px', width: '42px', height: '28px' });
  });

  it('lets go of a block that is deleted from under it', () => {
    const { view } = mount(calloutNote);
    hover(blockElement(0));

    act(() => {
      view.dispatch(view.state.tr.delete(0, view.state.doc.child(0).nodeSize));
    });
    remeasure();
    expect(buttons()).toEqual([]);

    // Left holding the dead block the chrome would never offer itself again.
    hover(blockElement(0));
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
  });
});
