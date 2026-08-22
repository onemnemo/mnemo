// @vitest-environment jsdom

/**
 * The pointer sequences themselves: press, move, release, over a mounted editor.
 *
 * The rule under test is that one press means one thing for as long as it is
 * held, so a press alone cannot prove it: only the move can, since that is where
 * an answer would change. It has to hold on an engine that will not give up a
 * text drag on request, or the range keeps extending under the block bands.
 *
 * jsdom lays nothing out, so the boxes are stubbed: three stacked rows with a
 * gutter either side, which is all the geometry the band arithmetic reads.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNoteEditState } from '../edit/build-edit-state';
import { block, span } from '../editor/mapper/fixtures';
import { BlockSelectionOverlay } from './BlockSelectionOverlay';
import { getBlockSelection, setBlockSelection } from './block-selection-plugin';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Blocks = Parameters<typeof buildNoteEditState>[0];

const ROW_H = 40;
const TEXT_LEFT = 56;
const TEXT_RIGHT = 744;
const VIEWPORT = { width: 800, height: 600 };
/** Inside the left gutter, clear of the text column. */
const GUTTER_X = 20;

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  } as DOMRect;
}

interface Mounted {
  view: EditorView;
  /** The scroll container, which is what the overlay listens on. */
  container: HTMLElement;
  /** The page column around the editor, the marquee's surface. */
  column: HTMLElement;
}

let mounted: Mounted | null = null;
let root: Root | null = null;
let restoreRects: (() => void) | null = null;

/**
 * Stacks the top-level blocks and gives the container a viewport, computed on
 * each call rather than assigned once: selecting redecorates the blocks, and an
 * element that ProseMirror rebuilt would otherwise report zeros again.
 */
function stubLayout(container: HTMLElement, editorRoot: HTMLElement): () => void {
  const saved = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element): DOMRect {
      if (this === container) return rect(0, 0, VIEWPORT.width, VIEWPORT.height);
      if (this.parentElement === editorRoot) {
        const index = Array.prototype.indexOf.call(editorRoot.children, this);
        return rect(TEXT_LEFT, index * ROW_H, TEXT_RIGHT, index * ROW_H + ROW_H);
      }
      return rect(0, 0, 0, 0);
    },
  });
  return () => {
    if (saved) Object.defineProperty(Element.prototype, 'getBoundingClientRect', saved);
  };
}

function open(blocks: Blocks): Mounted {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');

  const container = document.createElement('div');
  const column = document.createElement('div');
  const mount = document.createElement('div');
  mount.className = 'notes-doc';
  column.appendChild(mount);
  container.appendChild(column);
  document.body.appendChild(container);

  const view = new EditorView(mount, { state: built.state, editable: () => true });
  restoreRects = stubLayout(container, view.dom);

  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <BlockSelectionOverlay view={view} registry={built.registry} scrollRef={{ current: container }} />,
    );
  });

  mounted = { view, container, column };
  return mounted;
}

/** The top-level block element for row `index`, which is what a press lands on. */
function row(index: number): HTMLElement {
  const el = mounted?.view.dom.children[index];
  if (!(el instanceof HTMLElement)) throw new Error(`no row ${String(index)}`);
  return el;
}

function press(target: Element, x: number, y: number): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  });
}

/** A move, plus the frame the overlay paints and selects on. */
function moveTo(x: number, y: number): void {
  act(() => {
    window.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }),
    );
    vi.advanceTimersByTime(20);
  });
}

function release(): void {
  act(() => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, isPrimary: true }));
  });
}

function pressEscape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  });
}

function selectedCount(): number {
  return getBlockSelection(mounted!.view.state).selected.size;
}

function marking(): boolean {
  return mounted!.view.dom.hasAttribute('data-block-drag');
}

const three = (): Blocks => [
  block('Text', [span('first')]),
  block('Text', [span('second')]),
  block('Text', [span('third')]),
];

/** Every sid in the document, in order, for selecting a known starting set. */
function allSids(): string[] {
  const sids: string[] = [];
  mounted!.view.state.doc.forEach((node) => {
    const sid: unknown = node.attrs.sid;
    if (typeof sid === 'string' && sid !== '') sids.push(sid);
  });
  return sids;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  restoreRects?.();
  restoreRects = null;
  mounted?.view.destroy();
  mounted = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('a drag that starts in the text', () => {
  it('stays text, however many blocks it crosses', () => {
    open(three());
    press(row(0), 300, 10);
    moveTo(300, 50);
    moveTo(300, 110);
    expect(selectedCount()).toBe(0);
    release();
    expect(selectedCount()).toBe(0);
  });

  it('never marks the editor, so the browser keeps painting the range', () => {
    open(three());
    press(row(0), 300, 10);
    moveTo(300, 110);
    expect(marking()).toBe(false);
    release();
    expect(marking()).toBe(false);
  });

  it('leaves the range the browser built across two blocks intact', () => {
    // Whatever the browser has built by the end of the drag is the answer. A
    // collapse partway through is the half of the conflict ProseMirror can see:
    // the caret jumps to the press point while the bands claim the same gesture.
    const { view } = open(three());
    const from = 2;
    const to = view.state.doc.content.size - 2;
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    });
    press(row(0), 300, 10);
    moveTo(300, 110);
    release();
    expect(view.state.selection.empty).toBe(false);
    expect(view.state.selection.from).toBe(from);
    expect(view.state.selection.to).toBe(to);
  });

  it('leaves a standing block selection to ProseMirror to clear, not to itself', () => {
    // The press is not this overlay's, so it neither clears nor replaces the
    // set; the caret the press moves is what ends it.
    const { view } = open(three());
    act(() => {
      setBlockSelection(view, { selected: new Set(allSids()), anchorSid: allSids()[0] });
    });
    expect(selectedCount()).toBe(3);
    press(row(1), 300, 50);
    moveTo(300, 110);
    expect(selectedCount()).toBe(3);
  });
});

describe('a drag from the page around the editor', () => {
  it('selects every block the band covers', () => {
    open(three());
    press(mounted!.column, GUTTER_X, 10);
    moveTo(300, 50);
    expect(selectedCount()).toBe(2);
    release();
    expect(selectedCount()).toBe(2);
  });

  it('reaches the whole document when the band does', () => {
    open(three());
    press(mounted!.column, GUTTER_X, 5);
    moveTo(300, 115);
    expect(selectedCount()).toBe(3);
  });

  it('marks the editor for the length of the drag and releases it', () => {
    open(three());
    press(mounted!.column, GUTTER_X, 10);
    expect(marking()).toBe(false);
    moveTo(300, 50);
    expect(marking()).toBe(true);
    release();
    expect(marking()).toBe(false);
  });

  it('deselects on a press that never becomes a drag', () => {
    const { view } = open(three());
    act(() => {
      setBlockSelection(view, { selected: new Set(allSids()), anchorSid: allSids()[0] });
    });
    press(mounted!.column, GUTTER_X, 10);
    release();
    expect(selectedCount()).toBe(0);
  });

  it('abandons the drag and its selection on Escape', () => {
    open(three());
    press(mounted!.column, GUTTER_X, 10);
    moveTo(300, 50);
    expect(selectedCount()).toBe(2);
    pressEscape();
    expect(selectedCount()).toBe(0);
    expect(marking()).toBe(false);
    // The gesture is over, so the pointer that is still down moves nothing.
    moveTo(300, 110);
    expect(selectedCount()).toBe(0);
  });
});

describe('a press that belongs to something else', () => {
  it('is left to its own gesture', () => {
    open(three());
    const cases = ['button', 'div'];
    const classes = ['', 'notes-table'];
    for (const [index, tag] of cases.entries()) {
      const el = document.createElement(tag);
      if (classes[index]) el.className = classes[index];
      mounted!.column.appendChild(el);
      press(el, GUTTER_X, 10);
      moveTo(300, 50);
      expect(selectedCount()).toBe(0);
      release();
      el.remove();
    }
  });
});
