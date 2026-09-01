// @vitest-environment jsdom

/**
 * What a right-click offers, which depends on what it landed on.
 *
 * A picture answers about itself: right-clicking one has to reach the same rows its own pill does,
 * because "crop this" is what the gesture is asking and the generic block list cannot say it. Every
 * other block keeps the generic list, and that is the half worth pinning alongside.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { setBlockSelection } from '../../selection/block-selection-plugin';
import { block, span } from '../mapper/fixtures';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import { EditorContextMenu } from './EditorContextMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let view: EditorView | null = null;

/** A note whose second block is a picture, with the menu mounted over a stand-in for the editor. */
function mount(selectIndex: number) {
  const built = buildNoteEditState([
    block('Text', [span('prose')]),
    block('Image', [span('')], { kind: 'image', path: 'a.png', alt: '', width: 0, align: 'left', crop: null }),
  ]);
  if (!built.ok) throw new Error('fixture did not build');

  const host = document.createElement('div');
  document.body.appendChild(host);
  view = new EditorView(host, {
    state: built.state,
    nodeViews: toNodeViews(built.registry, resolveServices()),
  });

  let pos = 0;
  for (let i = 0; i < selectIndex; i++) pos += view.state.doc.child(i).nodeSize;
  const sid = String(view.state.doc.child(selectIndex).attrs.sid ?? '');
  act(() => {
    setBlockSelection(view!, { selected: new Set([sid]), anchorSid: sid });
  });
  // jsdom hit tests nothing, so the coordinate the menu resolves its block from is supplied.
  view.posAtCoords = () => ({ pos: pos + 1, inside: pos });

  const chrome = document.createElement('div');
  document.body.appendChild(chrome);
  root = createRoot(chrome);
  act(() =>
    root?.render(
      <EditorContextMenu view={view} registry={built.registry}>
        <div data-testid="surface" />
      </EditorContextMenu>,
    ),
  );

  const surface = chrome.querySelector('[data-testid="surface"]');
  if (!surface) throw new Error('the trigger did not render');
  return { surface };
}

/** The press the menu snapshots from, then the menu itself. */
function rightClick(surface: Element) {
  act(() => {
    surface.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2, clientX: 10, clientY: 10 }));
  });
  act(() => {
    surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  });
  // No bundle is loaded in a test, so a translated label renders as its own key.
  return document.body.textContent ?? '';
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe('EditorContextMenu', () => {
  it('offers the picture rows on a picture, in place of the generic block ones', () => {
    const text = rightClick(mount(1).surface);
    expect(text).toContain('ImageCropReposition');
    expect(text).toContain('ImageFlyoutReplace');
    expect(text).toContain('ImageAlign');
    expect(text).toContain('ImageSize');
    expect(text).toContain('ImageFlyoutDelete');
    // The generic rows are not also there; the picture's list replaces them rather than joining.
    expect(text).not.toContain('TurnInto');
    expect(text).not.toContain('MoveUp');
  });

  it('leaves every other block with the generic rows', () => {
    const text = rightClick(mount(0).surface);
    expect(text).toContain('MoveUp');
    expect(text).toContain('TurnInto');
    expect(text).not.toContain('ImageCropReposition');
  });
});
