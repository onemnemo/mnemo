// @vitest-environment jsdom

/**
 * The picker host: what it opens on, what it opens over, and when it refuses.
 *
 * The picker itself is covered where it lives; what matters here is that a
 * request raised from anywhere in the editor resolves to a live callout, that a
 * request naming a block that has gone opens nothing, and that a clear reaches
 * the document, which is the one path back to a glyph-less callout.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import { CalloutIconPicker } from './CalloutIconPicker';
import { calloutIconRequest, closeCalloutIcon, openCalloutIcon } from './callout-icon-request';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Radix positions its layers with Popper, which measures the content it floats.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver;

type Blocks = Parameters<typeof buildNoteEditState>[0];

const note: Blocks = [
  block('Callout', [span('remember')], { kind: 'callout', emoji: '💡', tone: 'note' }),
  block('Text', [span('after')]),
];

let root: Root | null = null;
let view: EditorView | null = null;

function mount(blocks: Blocks = note): EditorView {
  const built = buildNoteEditState(blocks);
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
  const editor = view;
  act(() => root?.render(<CalloutIconPicker view={editor} registry={built.registry} />));
  return editor;
}

/** The block at `index`, as the request names it. */
function target(editor: EditorView, index: number): { pos: number; sid: string } {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
  return { pos, sid: String(editor.state.doc.child(index).attrs.sid ?? '') };
}

/** Raise the picker and let the tick it waits for pass. */
function raise(request: { pos: number; sid: string }): void {
  // Two passes: the effect that arms the tick only runs once the store's change
  // has been rendered.
  act(() => openCalloutIcon(request));
  act(() => {
    vi.advanceTimersByTime(1);
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"][aria-label="CalloutIcon"]');
}

beforeEach(() => {
  vi.useFakeTimers();
  closeCalloutIcon();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  view?.destroy();
  view = null;
  closeCalloutIcon();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('CalloutIconPicker', () => {
  it('opens on a request, over the glyph it was raised from', () => {
    const editor = mount();
    raise(target(editor, 0));
    expect(dialog()).not.toBeNull();
  });

  it('opens nothing for a request naming a block that is gone', () => {
    const editor = mount();
    const gone = target(editor, 0);
    act(() => {
      editor.dispatch(editor.state.tr.delete(gone.pos, gone.pos + editor.state.doc.child(0).nodeSize));
    });
    raise(gone);
    expect(dialog()).toBeNull();
    // Left standing, the request would reopen the picker on the next render.
    expect(calloutIconRequest()).toBeNull();
  });

  it('opens nothing for a request naming a block that is not a callout', () => {
    const editor = mount();
    raise(target(editor, 1));
    expect(dialog()).toBeNull();
    expect(calloutIconRequest()).toBeNull();
  });

  it('clears the glyph from the document, and the callout keeps its text', () => {
    const editor = mount();
    raise(target(editor, 0));
    const clear = dialog()?.querySelector('[aria-label="NoIcon"]');
    if (!(clear instanceof HTMLButtonElement)) throw new Error('no clear button');
    act(() => {
      clear.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(editor.state.doc.child(0).attrs.emoji).toBe('');
    expect(editor.state.doc.child(0).textContent).toBe('remember');
    const glyph = editor.dom.querySelector('.notes-callout-glyph');
    expect(glyph instanceof HTMLElement && glyph.hidden).toBe(true);
    // The picker is done with, so the next press raises a fresh one.
    expect(calloutIconRequest()).toBeNull();
  });

  it('lets go of the request when the picker is dismissed', () => {
    const editor = mount();
    raise(target(editor, 0));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calloutIconRequest()).toBeNull();
    expect(dialog()).toBeNull();
  });
});
