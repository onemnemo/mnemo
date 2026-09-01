// @vitest-environment jsdom

/**
 * What a right-click offers, which depends on what it landed on.
 *
 * A picture answers about itself: right-clicking one has to reach the same rows its own pill does,
 * because "crop this" is what the gesture is asking and the generic block list cannot say it. Every
 * other block keeps the generic list, and that is the half worth pinning alongside.
 *
 * Which block was landed on is the other half. Over a picture the coordinate resolves to nothing,
 * because the media is the node view's own opaque DOM, so the press itself has to say, and the
 * cases worth pinning are the ones where trusting it would be wrong: a press naming a block that
 * is no longer there, and a press that has already answered once.
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
import { recordImagePress, takeImagePress } from './image-press';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let view: EditorView | null = null;

interface Mounted {
  readonly surface: Element;
  /** Position just before the `index`-th top-level block. */
  posOf(index: number): number;
  sidOf(index: number): string;
}

/**
 * A note whose second block is a picture, with the menu mounted over a stand-in for the editor.
 *
 * `coordsIndex` is what the pointer's coordinate resolves to; `null` is the live case over a
 * picture, where jsdom and Chromium agree that there is no position to answer with. A `null`
 * `selectIndex` is the other live case, a press with nothing selected behind it.
 */
function mount(selectIndex: number | null, coordsIndex: number | null = selectIndex): Mounted {
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
  const mountedView = view;

  const posOf = (index: number): number => {
    let pos = 0;
    for (let i = 0; i < index; i++) pos += mountedView.state.doc.child(i).nodeSize;
    return pos;
  };
  const sidOf = (index: number): string => String(mountedView.state.doc.child(index).attrs.sid ?? '');

  if (selectIndex !== null) {
    const sid = sidOf(selectIndex);
    act(() => {
      setBlockSelection(mountedView, { selected: new Set([sid]), anchorSid: sid });
    });
  }
  // jsdom hit tests nothing, so the coordinate the menu resolves its block from is supplied.
  const coordsPos = coordsIndex === null ? null : posOf(coordsIndex);
  mountedView.posAtCoords = () => (coordsPos === null ? null : { pos: coordsPos + 1, inside: coordsPos });

  const chrome = document.createElement('div');
  document.body.appendChild(chrome);
  root = createRoot(chrome);
  act(() =>
    root?.render(
      <EditorContextMenu view={mountedView} registry={built.registry}>
        <div data-testid="surface" />
      </EditorContextMenu>,
    ),
  );

  const surface = chrome.querySelector('[data-testid="surface"]');
  if (!surface) throw new Error('the trigger did not render');
  return { surface, posOf, sidOf };
}

function press(surface: Element, button: number) {
  act(() => {
    surface.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button, clientX: 10, clientY: 10 }));
  });
}

/** The press the menu snapshots from, then the menu itself. */
function rightClick(surface: Element) {
  press(surface, 2);
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
  // The slot is module state; a test that armed it must not arm the next one.
  takeImagePress();
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

  it('offers the picture rows on the press alone, with nothing selected', () => {
    // The live shape: a right-click on a picture selects nothing, and its media answers no
    // coordinate, so the press is the only thing left that can name what was pressed.
    const mounted = mount(null, null);
    recordImagePress({ pos: mounted.posOf(1), sid: mounted.sidOf(1) });
    const text = rightClick(mounted.surface);
    expect(text).toContain('ImageCropReposition');
    expect(text).not.toContain('MoveUp');
  });

  it('still offers nothing on a plain caret press, so the webview keeps its spelling menu', () => {
    const text = rightClick(mount(null, 0).surface);
    expect(text).not.toContain('ImageCropReposition');
    expect(text).not.toContain('MoveUp');
  });

  it('takes the picture from the press when the coordinate resolves to nothing', () => {
    // The live shape of the defect: the press selected the picture, the coordinate over its
    // media answers nothing, and the caret is still back in the paragraph above.
    const mounted = mount(1, null);
    recordImagePress({ pos: mounted.posOf(1), sid: mounted.sidOf(1) });
    const text = rightClick(mounted.surface);
    expect(text).toContain('ImageCropReposition');
    expect(text).not.toContain('MoveUp');
  });

  it('ignores a press whose block is no longer the one it named', () => {
    const mounted = mount(1, 0);
    recordImagePress({ pos: mounted.posOf(1), sid: 'gone42' });
    const text = rightClick(mounted.surface);
    // Refused, so the coordinate decides, and it points at the paragraph.
    expect(text).toContain('MoveUp');
    expect(text).not.toContain('ImageCropReposition');
  });

  it('spends the press on one snapshot, so a second right-click reads the coordinate', () => {
    const mounted = mount(1, 0);
    recordImagePress({ pos: mounted.posOf(1), sid: mounted.sidOf(1) });
    expect(rightClick(mounted.surface)).toContain('ImageCropReposition');
    // Every press takes a fresh snapshot, and this one has no press left to read.
    const text = rightClick(mounted.surface);
    expect(text).toContain('MoveUp');
    expect(text).not.toContain('ImageCropReposition');
  });

  it('drops a press that opened no menu, so it cannot decide a later one', () => {
    const mounted = mount(0, 0);
    // A left click on the picture selects it and records the press, and no menu follows.
    recordImagePress({ pos: mounted.posOf(1), sid: mounted.sidOf(1) });
    press(mounted.surface, 0);
    const text = rightClick(mounted.surface);
    expect(text).toContain('MoveUp');
    expect(text).not.toContain('ImageCropReposition');
  });
});
