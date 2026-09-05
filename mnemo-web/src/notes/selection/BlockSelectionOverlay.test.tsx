// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAGGING_CLASS } from '../../lib/dnd/drag-select';
import { buildNoteEditState } from '../edit/build-edit-state';
import { block, span } from '../editor/mapper/fixtures';
import type { BlockRegistry } from '../editor/registry/build';
import { clearBlockSelection, getBlockSelection } from './block-selection-plugin';
import { BlockSelectionOverlay } from './BlockSelectionOverlay';
import { marqueeRows } from './marquee-hit';

type Blocks = Parameters<typeof buildNoteEditState>[0];

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

let pane: HTMLElement;
let scroll: HTMLElement;
let editorMount: HTMLElement;
let overlayMount: HTMLElement;
let overlayRoot: Root;
let view: EditorView;
let registry: BlockRegistry;
let nextFrame: number;
let frames: Map<number, FrameRequestCallback>;

function flushFrames(): void {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    for (const callback of pending) callback(0);
  });
}

function open(blocks: Blocks): void {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  registry = built.registry;

  pane = document.createElement('div');
  scroll = document.createElement('div');
  editorMount = document.createElement('div');
  scroll.append(editorMount);
  pane.appendChild(scroll);
  document.body.appendChild(pane);

  view = new EditorView(editorMount, { state: built.state, editable: () => true });
  view.dom.getBoundingClientRect = () => box(100, 0, 500, 400);
  scroll.getBoundingClientRect = () => box(0, 0, 600, 400);
  Object.defineProperties(scroll, {
    clientHeight: { configurable: true, value: 400 },
    // Ten narrower than the border box, the reserved scrollbar gutter the real
    // scroller carries, so the page's right margin ends at 590 and not at 600.
    clientWidth: { configurable: true, value: 590 },
    scrollHeight: { configurable: true, value: 1200 },
  });
  [...view.dom.children].forEach((child, index) => {
    child.getBoundingClientRect = () => box(100, index * 50, 500, index * 50 + 40);
  });

  overlayMount = document.createElement('div');
  pane.appendChild(overlayMount);
  overlayRoot = createRoot(overlayMount);
  act(() => {
    overlayRoot.render(
      <BlockSelectionOverlay
        view={view}
        registry={registry}
        paneRef={{ current: pane }}
        scrollRef={{ current: scroll }}
      />,
    );
  });
}

function pointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  pointerId = 1,
  isPrimary = true,
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: type === 'pointerdown' ? 0 : -1,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    clientX: x,
    clientY: y,
    isPrimary,
    pointerId,
  });
  act(() => target.dispatchEvent(event));
  flushFrames();
  return event;
}

function selected(): ReadonlySet<string> {
  return getBlockSelection(view.state).selected;
}

/** Answer every coordinate lookup with `pos`, and collect the points asked for. */
function answerCoordsWith(pos: number): { left: number; top: number }[] {
  const asked: { left: number; top: number }[] = [];
  view.posAtCoords = (coords) => {
    asked.push(coords);
    return { pos, inside: pos };
  };
  return asked;
}

/**
 * One two-column row, laid out by hand. The row fills the document column the
 * way a top-level block does, 100 to 500, and its two lanes split it either side
 * of the splitter: 100-295 and 305-500. Enough geometry to tell a band that
 * reached one lane from a band that only ever reached the column's own edge.
 */
function openTwoColumn(): { left: Blocks[number]; right: Blocks[number] } {
  const left = block('Text', [span('left')]);
  const right = block('Text', [span('right')]);
  open([
    block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
      children: [
        block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [left] }),
        block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [right] }),
      ],
    }),
  ]);
  // The fixture's first transaction runs the editor's invariant normalization;
  // settle it before the view-only gesture whose state it deliberately clears.
  view.dispatch(view.state.tr);
  view.dom.firstElementChild!.getBoundingClientRect = () => box(100, 0, 500, 80);
  const children = marqueeRows(view.state.doc, registry)[0].cellChildren ?? [];
  const leftDom = view.nodeDOM(children[0].pos);
  const rightDom = view.nodeDOM(children[1].pos);
  if (!(leftDom instanceof HTMLElement) || !(rightDom instanceof HTMLElement)) {
    throw new Error('column children did not render');
  }
  leftDom.getBoundingClientRect = () => box(100, 0, 295, 80);
  rightDom.getBoundingClientRect = () => box(305, 0, 500, 80);
  const nodeDOM = view.nodeDOM.bind(view);
  view.nodeDOM = (pos) => {
    if (pos === children[0].pos) return leftDom;
    if (pos === children[1].pos) return rightDom;
    return nodeDOM(pos);
  };
  return { left, right };
}

beforeEach(() => {
  // jsdom has no hit testing at all, and the view's coordinate lookup reaches
  // for it directly; a miss is the honest answer for a document never laid out.
  (document as Document & { elementFromPoint?: () => Element | null }).elementFromPoint = () => null;
  nextFrame = 0;
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => {
    frames.delete(frame);
  });
});

afterEach(() => {
  vi.useRealTimers();
  if (overlayRoot) act(() => overlayRoot.unmount());
  view?.destroy();
  pane?.remove();
  document.body.classList.remove(DRAGGING_CLASS);
  document.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

describe('block marquee pointer ownership', () => {
  it('leaves a text drag across blocks entirely to native selection', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    const firstLine = view.dom.firstElementChild?.querySelector('[data-line]');
    if (!(firstLine instanceof HTMLElement)) throw new Error('first line did not render');

    expect(pointer(firstLine, 'pointerdown', 140, 20).defaultPrevented).toBe(false);
    pointer(window, 'pointermove', 180, 80);
    pointer(window, 'pointerup', 180, 80);

    expect(selected().size).toBe(0);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(document.querySelector('.notes-marquee')).toBeNull();
  });

  it('suppresses native selection and collapses marked text at gutter pointer-down', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 7)));
    const text = view.dom.querySelector('[data-line]')?.firstChild;
    if (!text) throw new Error('text did not render');
    const range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection()?.addRange(range);

    const down = pointer(scroll, 'pointerdown', 50, 10);

    expect(down.defaultPrevented).toBe(true);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(true);
    expect(view.dom.hasAttribute('data-block-marquee')).toBe(true);
    expect(document.getSelection()?.rangeCount).toBe(0);
    expect(view.state.selection.empty).toBe(true);
  });

  it('selects every block intersected by a gutter drag without changing the document', () => {
    const blocks = [block('Text', [span('first')]), block('Text', [span('second')]), block('Text', [span('third')])];
    const expected = blocks.map((item) => item.sid);
    open(blocks);
    const doc = view.state.doc;

    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 150, 125);

    expect([...selected()]).toEqual(expected);
    expect(view.state.doc).toBe(doc);
    pointer(window, 'pointerup', 150, 125);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(view.dom.hasAttribute('data-block-marquee')).toBe(false);
  });

  it('keeps the painted marquee anchored to the exact gutter press', () => {
    const blocks = [block('Text', [span('first')]), block('Text', [span('second')])];
    open(blocks);

    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 170, 90);

    const marquee = document.querySelector<HTMLElement>('.notes-marquee');
    expect(marquee?.style.left).toBe('50px');
    expect(marquee?.style.top).toBe('10px');
    expect(marquee?.style.width).toBe('120px');
    expect(marquee?.style.height).toBe('80px');
    expect([...selected()]).toEqual(blocks.map((item) => item.sid));
  });

  it.each([
    ['left margin', 50, 70, 120],
    ['right margin', 520, 540, 450],
  ] as const)(
    'selects nothing while the sweep stays in the %s, whatever rows it passes',
    (_where, from, still, across) => {
      open([block('Text', [span('first')]), block('Text', [span('second')])]);

      pointer(scroll, 'pointerdown', from, 10);
      pointer(window, 'pointermove', still, 90);

      // The box is live and painted, but it has not touched a block yet: the
      // marquee selects what it overlaps on both axes, not every row it passes.
      expect(document.querySelector('.notes-marquee')).not.toBeNull();
      expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(true);
      expect(selected().size).toBe(0);

      pointer(window, 'pointermove', across, 90);
      expect(selected().size).toBe(2);
    },
  );

  it('ignores movement and release from a pointer that does not own the gesture', () => {
    const blocks = [block('Text', [span('first')]), block('Text', [span('second')])];
    open(blocks);

    pointer(scroll, 'pointerdown', 50, 10, 1);
    pointer(window, 'pointermove', 170, 90, 2, false);
    pointer(window, 'pointerup', 170, 90, 2, false);

    expect(document.querySelector('.notes-marquee')).toBeNull();
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(true);
    expect(selected().size).toBe(0);

    pointer(window, 'pointermove', 150, 90, 1);
    expect([...selected()]).toEqual(blocks.map((item) => item.sid));
    pointer(window, 'pointerup', 150, 90, 1);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('does not let a non-primary pointer arm a marquee', () => {
    open([block('Text', [span('first')])]);

    const down = pointer(scroll, 'pointerdown', 50, 10, 2, false);

    expect(down.defaultPrevented).toBe(false);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(view.dom.hasAttribute('data-block-marquee')).toBe(false);
  });

  it('restores suppression and removes gesture listeners after a gutter click', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);

    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointerup', 50, 10);
    // The probe crosses into the blocks, so a listener that leaked past the
    // click would show up as a selection.
    pointer(window, 'pointermove', 150, 90);

    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(view.dom.hasAttribute('data-block-marquee')).toBe(false);
    expect(selected().size).toBe(0);
  });

  it('places the caret on the pressed row when a margin press never moves', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    // The second block's first text position. jsdom lays nothing out, so the
    // view's own hit testing has no geometry to read and the answer is stubbed;
    // what the test is about is the point it gets asked and what is done with
    // the reply.
    const secondLine = view.state.doc.child(0).nodeSize + 2;
    const asked = answerCoordsWith(secondLine);

    pointer(scroll, 'pointerdown', 50, 60);
    pointer(window, 'pointerup', 50, 60);

    // Pulled inside the document column, because the press itself happened in
    // the margin where nothing resolves.
    expect(asked).toEqual([{ left: 108, top: 60 }]);
    expect(view.state.selection.empty).toBe(true);
    expect(view.state.selection.from).toBe(secondLine);
    expect(view.hasFocus()).toBe(true);
  });

  it('places no caret when the press became a marquee', () => {
    const blocks = [block('Text', [span('first')]), block('Text', [span('second')])];
    open(blocks);
    const asked = answerCoordsWith(2);

    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 150, 90);
    pointer(window, 'pointerup', 150, 90);

    expect(asked).toEqual([]);
    expect([...selected()]).toEqual(blocks.map((item) => item.sid));
  });

  it('receives margin presses from the floating gutter chrome sibling', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 150, 90);
    pointer(window, 'pointerup', 150, 90);
    expect(selected().size).toBe(2);
    const chromeRow = document.createElement('div');
    chromeRow.setAttribute('data-block-gutter', '');
    pane.appendChild(chromeRow);

    const down = pointer(chromeRow, 'pointerdown', 50, 10);

    expect(down.defaultPrevented).toBe(true);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(true);
    // Passing the margin gates makes this press a page press: it deselects
    // before any marquee movement, the same as one from the scroller.
    expect(selected().size).toBe(0);
    pointer(window, 'pointerup', 50, 10);
  });

  it('leaves the pane chrome floating over the margin to its own presses', () => {
    const blocks = [block('Text', [span('first')]), block('Text', [span('second')])];
    open(blocks);
    // The save row: a pane sibling of the scroller, anchored in the right
    // margin, whose label is a span rather than a control. Scrolled far enough
    // that the document's rows reach up behind it, it sits inside every bound
    // the marquee tests, and only the surface rule keeps the gesture off it.
    const chromeRow = document.createElement('div');
    const saveLabel = document.createElement('span');
    chromeRow.appendChild(saveLabel);
    pane.appendChild(chromeRow);

    const down = pointer(saveLabel, 'pointerdown', 550, 10);
    // Into the blocks, so a wrongly claimed press would select something.
    pointer(window, 'pointermove', 450, 90);

    expect(down.defaultPrevented).toBe(false);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(selected().size).toBe(0);
  });

  it('starts a marquee from the right page margin', () => {
    const blocks = [block('Text', [span('first')]), block('Text', [span('second')])];
    open(blocks);

    pointer(scroll, 'pointerdown', 550, 10);
    pointer(window, 'pointermove', 450, 90);

    expect([...selected()]).toEqual(blocks.map((item) => item.sid));
  });

  it('stops the right margin at the content edge, short of the scrollbar', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);

    const down = pointer(scroll, 'pointerdown', 595, 10);

    expect(down.defaultPrevented).toBe(false);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('takes an inset row only once the band reaches it', () => {
    const blocks = [block('Text', [span('first')]), block('Text', [span('second')])];
    open(blocks);
    // A row inset from the column: the band covers its height early but only
    // meets it on the horizontal axis once the pointer crosses x=160.
    view.dom.children[1].getBoundingClientRect = () => box(160, 50, 460, 90);

    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 150, 85);
    expect([...selected()]).toEqual([blocks[0].sid]);

    pointer(window, 'pointermove', 165, 85);
    expect([...selected()]).toEqual(blocks.map((item) => item.sid));
  });

  it('claims only the lane beside real block rows', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);

    expect(pointer(scroll, 'pointerdown', 50, -1).defaultPrevented).toBe(false);
    expect(pointer(scroll, 'pointerdown', 50, 91).defaultPrevented).toBe(false);
    expect(pointer(scroll, 'pointerdown', 101, 10).defaultPrevented).toBe(false);

    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(selected().size).toBe(0);
  });

  it.each(['pointercancel', 'Escape'] as const)('cleans up a live marquee on %s', (ending) => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 150, 90);
    expect(selected().size).toBe(2);

    if (ending === 'pointercancel') pointer(window, 'pointercancel', 50, 90);
    else act(() => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));

    expect(selected().size).toBe(0);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(view.dom.hasAttribute('data-block-marquee')).toBe(false);
    pointer(window, 'pointermove', 150, 120);
    expect(selected().size).toBe(0);
  });

  it('restores suppression and removes listeners when the overlay unmounts', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 150, 90);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(true);

    act(() => overlayRoot.unmount());
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
    expect(view.dom.hasAttribute('data-block-marquee')).toBe(false);
    clearBlockSelection(view);
    pointer(window, 'pointermove', 150, 120);
    expect(selected().size).toBe(0);
  });

  it('does not claim tables, splitters, controls, or block handles inside the margin', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    const targets = [
      Object.assign(document.createElement('div'), { className: 'notes-table' }),
      Object.assign(document.createElement('div'), { className: 'notes-column-splitter' }),
      document.createElement('button'),
      document.createElement('a'),
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
      (() => {
        const item = document.createElement('div');
        item.setAttribute('role', 'menuitem');
        return item;
      })(),
      Object.assign(document.createElement('button'), { className: 'cursor-grab' }),
    ];
    scroll.append(...targets);

    for (const target of targets) {
      expect(pointer(target, 'pointerdown', 50, 10).defaultPrevented).toBe(false);
      pointer(window, 'pointermove', 200, 90);
      pointer(window, 'pointerup', 200, 90);
    }

    expect(selected().size).toBe(0);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('does not claim the header or empty space below the last block', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    const header = document.createElement('h1');
    const emptyLayout = document.createElement('div');
    scroll.append(header, emptyLayout);

    expect(pointer(header, 'pointerdown', 50, -1).defaultPrevented).toBe(false);
    expect(pointer(emptyLayout, 'pointerdown', 50, 91).defaultPrevented).toBe(false);
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
  });

  it('deselects on a press in the page whitespace no marquee can start from', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    const header = document.createElement('h1');
    scroll.append(header);
    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 150, 90);
    pointer(window, 'pointerup', 150, 90);
    expect(selected().size).toBe(2);

    pointer(header, 'pointerdown', 50, -1);

    expect(selected().size).toBe(0);
  });

  it('keeps a standing selection when the press belongs to a control', () => {
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    const control = document.createElement('button');
    scroll.append(control);
    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 150, 90);
    pointer(window, 'pointerup', 150, 90);
    expect(selected().size).toBe(2);

    pointer(control, 'pointerdown', 50, -1);

    expect(selected().size).toBe(2);
  });

  it.each([
    ['over the content column', 200, 10],
    ['below the last block', 50, 95],
  ] as const)(
    'keeps a standing selection when a gutter row press lands %s',
    (_where, x, y) => {
      open([block('Text', [span('first')]), block('Text', [span('second')])]);
      pointer(scroll, 'pointerdown', 50, 10);
      pointer(window, 'pointermove', 150, 90);
      pointer(window, 'pointerup', 150, 90);
      expect(selected().size).toBe(2);

      // The handle row follows the hovered block, so it can float where no
      // marquee can start; a press it swallows there must not deselect.
      const chromeRow = document.createElement('div');
      chromeRow.setAttribute('data-block-gutter', '');
      pane.appendChild(chromeRow);
      const down = pointer(chromeRow, 'pointerdown', x, y);

      expect(down.defaultPrevented).toBe(false);
      expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false);
      expect(selected().size).toBe(2);
    },
  );

  it('keeps two-column child hit testing when the gutter drag ends in one lane', () => {
    const { left } = openTwoColumn();

    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 190, 70);

    expect([...selected()]).toEqual([left.sid]);
  });

  it('reaches the far lane of a two-column row once the drag crosses it', () => {
    const { left, right } = openTwoColumn();

    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 400, 70);

    expect([...selected()]).toEqual([left.sid, right.sid]);
  });

  it('claims lanes from the right margin in the order the band reaches them', () => {
    const { left, right } = openTwoColumn();

    pointer(scroll, 'pointerdown', 520, 10);
    pointer(window, 'pointermove', 400, 70);
    expect([...selected()]).toEqual([right.sid]);

    pointer(window, 'pointermove', 200, 70);
    expect([...selected()]).toEqual(expect.arrayContaining([left.sid, right.sid]));
    expect(selected().size).toBe(2);
  });

  it('continues the marquee while edge auto-scroll moves the note', () => {
    vi.useFakeTimers();
    open([block('Text', [span('first')]), block('Text', [span('second')])]);
    pointer(scroll, 'pointerdown', 50, 10);
    pointer(window, 'pointermove', 150, 395);

    act(() => vi.advanceTimersByTime(50));
    flushFrames();

    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect(selected().size).toBe(2);
  });
});
