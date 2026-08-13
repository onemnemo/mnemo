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
import { chromeRowGeometry } from './chrome-row';
import { setCalloutEmoji } from './callout-icon';
import { calloutIconRequest, closeCalloutIcon } from './callout-icon-request';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Radix positions its layers with Popper, which measures the content it floats.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

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
  act(() => root?.render(<BlockGutter view={view} registry={built.registry} />));

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
function hover(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 0, clientY: 0 }));
  });
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
