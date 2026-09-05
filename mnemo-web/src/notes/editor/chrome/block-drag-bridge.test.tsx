// @vitest-environment jsdom

/**
 * The inverted drag: what a block's own body reaches for, and how long it stays reachable.
 *
 * The registration is the part that breaks quietly. StrictMode runs the registering effect's
 * cleanup and then the effect again, so a cleanup that deletes unconditionally leaves the app
 * with a picture nobody can drag and a test suite that never notices.
 */

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DragPress } from '@/lib/dnd/usePointerDrag';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import { BlockGutter } from './BlockGutter';
import { pressBlockDrag, registerBlockDragPress } from './block-drag-bridge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let view: EditorView | null = null;

function press(x: number, y: number): DragPress {
  return { button: 0, pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y, target: null };
}

function move(x: number, y: number) {
  const event = new Event('pointermove') as Event & { clientX: number; clientY: number; pointerId: number };
  event.clientX = x;
  event.clientY = y;
  event.pointerId = 1;
  act(() => {
    window.dispatchEvent(event);
  });
}

/** The gutter, mounted under StrictMode, over a note whose second block is a heading. */
function mount() {
  const built = buildNoteEditState([
    block('Text', [span('one')]),
    block('Heading2', [span('two')]),
  ]);
  if (!built.ok) throw new Error('fixture did not build');
  const host = document.createElement('div');
  document.body.appendChild(host);
  view = new EditorView(host, {
    state: built.state,
    nodeViews: toNodeViews(built.registry, resolveServices()),
  });

  const chrome = document.createElement('div');
  document.body.appendChild(chrome);
  root = createRoot(chrome);
  act(() =>
    root?.render(
      <StrictMode>
        <BlockGutter view={view!} registry={built.registry} scrollRef={{ current: host }} />
      </StrictMode>,
    ),
  );
  return { view, registry: built.registry, chrome };
}

beforeEach(() => {
  // jsdom has no hit testing; the drag probes for an anchor block with it and treats a miss as
  // "nothing on screen there", which is the honest answer in a document that was never laid out.
  (document as Document & { elementFromPoint?: () => Element | null }).elementFromPoint = () => null;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe('block drag bridge', () => {
  it('keeps the gutter reachable through a StrictMode double mount', () => {
    const mounted = mount();
    expect(pressBlockDrag(mounted.view, press(0, 0), 0)).toBe(true);
  });

  it('is gone once the gutter is', () => {
    const mounted = mount();
    act(() => root?.unmount());
    root = null;
    expect(pressBlockDrag(mounted.view, press(0, 0), 0)).toBe(false);
  });

  it('resolves the block at the position and drags it under its own name', () => {
    const mounted = mount();
    // The second block, so a wrong resolution would name the first one instead.
    const pos = mounted.view.state.doc.child(0).nodeSize;
    act(() => {
      pressBlockDrag(mounted.view, press(0, 0), pos);
    });
    // Under the five pixel threshold the press is still only a press.
    move(3, 3);
    expect(document.body.textContent).not.toContain('Heading2');

    move(60, 60);
    expect(document.body.textContent).toContain('Heading2');
  });

  it('takes the block from the position it was handed, not the last one hovered', () => {
    const mounted = mount();
    act(() => {
      pressBlockDrag(mounted.view, press(0, 0), 0);
    });
    move(60, 60);
    expect(document.body.textContent).toContain('Text');
    expect(document.body.textContent).not.toContain('Heading2');
  });

  it('withdraws only its own registration', () => {
    const mounted = mount();
    const first = () => undefined;
    const remove = registerBlockDragPress(mounted.view, first);
    const second = () => undefined;
    registerBlockDragPress(mounted.view, second);
    // The first registration is stale by now; withdrawing it must not take the live one down.
    remove();
    expect(pressBlockDrag(mounted.view, press(0, 0), 0)).toBe(true);
  });
});
