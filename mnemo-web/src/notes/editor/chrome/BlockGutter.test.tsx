// @vitest-environment jsdom

/**
 * The gutter chrome: where its row lands, and what keeps it on screen.
 *
 * jsdom lays nothing out, so every rect it reports is zero and no mounted check
 * can say anything about pixels. The placement is therefore pinned as a pure
 * function, which is where the arithmetic lives, and the mounted half covers
 * what a layout-free DOM can still prove: which block the row is offered on,
 * how many buttons it draws there, and that it survives the two things that
 * used to take it away, the block's element being rebuilt under it and the
 * pointer leaving while one of its own layers is open.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import type { BlockRegistry } from '../registry/build';
import { BlockGutter } from './BlockGutter';
import { chromeButtonCount, chromeRowGeometry } from './chrome-row';
import { setCalloutEmoji } from './callout-icon';

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
  it('sits the ordinary two-button row in the margin, clear of the text', () => {
    const row = chromeRowGeometry({ blockLeft: 100, rootLeft: 100, buttons: 2 });
    expect(row.left).toBe(54);
    expect(row.left + row.width).toBeLessThan(100);
    // Nothing under it but the page's own margin, so it stays transparent.
    expect(row.overContent).toBe(false);
  });

  it('holds a three-button row inside the margin instead of outside the pane', () => {
    const row = chromeRowGeometry({ blockLeft: 100, rootLeft: 100, buttons: 3 });
    // Right-aligned it would want to start at 32, twelve pixels past the pane's
    // own left edge, which is where it used to be drawn: over the split divider
    // or over the window edge, depending on which side of the split this pane is.
    expect(row.left).toBe(100 - MARGIN);
    expect(row.left).toBeGreaterThanOrEqual(100 - MARGIN);
  });

  it('goes opaque exactly when the row reaches into the document column', () => {
    // The clamped callout row overlaps the block's own leading padding.
    expect(chromeRowGeometry({ blockLeft: 100, rootLeft: 100, buttons: 3 }).overContent).toBe(true);
    // A block in the right-hand cell of a two-column row has no margin of its
    // own, so its row is drawn over the left cell's text.
    expect(chromeRowGeometry({ blockLeft: 400, rootLeft: 100, buttons: 2 }).overContent).toBe(true);
  });

  it('keeps the plus and the grip at one distance from the block, whatever else is in the row', () => {
    // Measured where there is room for either row, so the clamp is not what is
    // being read: the extra button is added on the far left, not by pushing the
    // other two in.
    const two = chromeRowGeometry({ blockLeft: 400, rootLeft: 100, buttons: 2 });
    const three = chromeRowGeometry({ blockLeft: 400, rootLeft: 100, buttons: 3 });
    expect(two.left + two.width).toBe(three.left + three.width);
    expect(three.left).toBeLessThan(two.left);
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
  const view = new EditorView(host, { state: built.state });

  const chrome = document.createElement('div');
  document.body.appendChild(chrome);
  root = createRoot(chrome);
  act(() => root?.render(<BlockGutter view={view} registry={built.registry} />));

  mounted = { view, registry: built.registry, chrome };
  return mounted;
}

beforeEach(() => {
  vi.useFakeTimers();
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
  it('offers the callout a third button for its glyph', () => {
    mount(calloutNote);
    hover(blockElement(0));
    expect(buttons()).toEqual(['CalloutIcon', 'InsertBlockBelow', 'BlockActionsFormat']);
  });

  it('offers a block that draws its own content only the two', () => {
    mount(calloutNote);
    hover(blockElement(1));
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
  });

  it('drops the third button again when the pointer moves off the callout', () => {
    mount(calloutNote);
    hover(blockElement(0));
    hover(blockElement(1));
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
  });

  it('stays on the callout when the glyph write rebuilds its element', () => {
    const { view, registry } = mount(calloutNote);
    hover(blockElement(0));
    const before = blockElement(0);

    act(() => {
      setCalloutEmoji(view, registry, { pos: 0, sid: String(view.state.doc.child(0).attrs.sid) }, '🚀');
    });
    // A callout has no view of its own, so an attrs change is a rebuild: the
    // element the chrome was following is gone from the document, and following
    // it is what used to end with the button vanishing under the pointer.
    expect(before.isConnected).toBe(false);

    remeasure();
    expect(buttons()).toEqual(['CalloutIcon', 'InsertBlockBelow', 'BlockActionsFormat']);
  });

  it('lets go of the block when the pointer leaves', () => {
    mount(calloutNote);
    hover(blockElement(0));
    leave();
    expect(buttons()).toEqual([]);
  });

  it('holds the chrome on its block while the glyph picker is open', () => {
    mount(calloutNote);
    hover(blockElement(0));
    const picker = mounted?.chrome.querySelector('[aria-label="CalloutIcon"]');
    if (!picker) throw new Error('no picker button');
    click(picker);

    leave();
    expect(buttons()).toEqual(['CalloutIcon', 'InsertBlockBelow', 'BlockActionsFormat']);
  });

  it('holds the chrome on its block while the block menu is open, the same flag', () => {
    mount(calloutNote);
    hover(blockElement(1));
    const grip = [...(mounted?.chrome.querySelectorAll('button') ?? [])].at(-1);
    if (!grip) throw new Error('no grip');
    click(grip);
    expect(grip.getAttribute('aria-expanded')).toBe('true');

    leave();
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
  });

  it("unsticks the chrome when the open picker's block goes out from under it", () => {
    const { view } = mount(calloutNote);
    hover(blockElement(0));
    const picker = mounted?.chrome.querySelector('[aria-label="CalloutIcon"]');
    if (!picker) throw new Error('no picker button');
    click(picker);
    expect(document.querySelector('[role="dialog"][aria-label="CalloutIcon"]')).not.toBeNull();

    // The block is deleted from somewhere else entirely, so the popover is torn
    // down with the chrome and never fires a close of its own.
    act(() => {
      view.dispatch(view.state.tr.delete(0, view.state.doc.child(0).nodeSize));
    });
    remeasure();
    expect(buttons()).toEqual([]);
    expect(document.querySelector('[role="dialog"][aria-label="CalloutIcon"]')).toBeNull();

    // Left believing a picker is still open, the chrome would stay pinned to the
    // block that no longer exists and never offer itself on another one again.
    hover(blockElement(0));
    expect(buttons()).toEqual(['InsertBlockBelow', 'BlockActionsFormat']);
  });
});

describe('chromeButtonCount', () => {
  it('counts three for a callout and two for anything else', () => {
    const built = buildNoteEditState(calloutNote);
    if (!built.ok) throw new Error('fixture did not build');
    expect(chromeButtonCount(built.state.doc.child(0))).toBe(3);
    expect(chromeButtonCount(built.state.doc.child(1))).toBe(2);
  });
});
