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
 * is no longer there, a press that has already answered once, and a menu asked for from the
 * keyboard, which has no press behind it at all and must not inherit the last one's.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { liveSegmentIds, locatedIssueFor } from '../../proofing/fixtures';
import { proofingKey } from '../../proofing/proofing-plugin';
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
  readonly view: EditorView;
  /** Position just before the `index`-th top-level block. */
  posOf(index: number): number;
  sidOf(index: number): string;
  /** Marks `word` in the first block and hands back the rendered mark. */
  markWord(word: string): HTMLElement;
}

/**
 * A note whose second block is a picture, with the menu mounted over the editor.
 *
 * The view sits inside the trigger, the way the note surface arranges it, so a press on
 * something the document rendered reaches the menu carrying that node as its target.
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
  surface.appendChild(host);

  const markWord = (word: string): HTMLElement => {
    const located = locatedIssueFor(mountedView.state.doc, sidOf(0), word);
    act(() => {
      mountedView.dispatch(
        mountedView.state.tr.setMeta(proofingKey, {
          type: 'answers',
          liveSegmentIds: liveSegmentIds(mountedView.state.doc),
          segmentIds: [located.issue.segmentId],
          issues: [located],
        }),
      );
    });
    const mark = mountedView.dom.querySelector('.proof-mark');
    if (!(mark instanceof HTMLElement)) throw new Error('the mark was not rendered');
    return mark;
  };

  return { surface, view: mountedView, posOf, sidOf, markWord };
}

function press(target: Element, button: number) {
  act(() => {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button, clientX: 10, clientY: 10 }));
  });
}

function contextMenu(target: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** The press the menu snapshots from, then the menu itself. */
function rightClick(target: Element) {
  press(target, 2);
  contextMenu(target);
  // No bundle is loaded in a test, so a translated label renders as its own key.
  return document.body.textContent ?? '';
}

/** Every row the open menu is showing, and whether it can be chosen. */
function rows(): { label: string; disabled: boolean }[] {
  return Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => ({
    // A row lays its icon and hint out in slots of their own, so the text it
    // renders carries the whitespace between them.
    label: (item.textContent ?? '').replace(/\s+/g, ' ').trim(),
    disabled: item.hasAttribute('data-disabled'),
  }));
}

const labels = () => rows().map((row) => row.label);

/**
 * A window that answers a clipboard read itself, which is what earns the Paste row.
 * jsdom has neither constructor and reports no platform, so both are supplied.
 */
function allowPaste(): void {
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: { read: () => Promise.resolve([]) },
    configurable: true,
  });
  Reflect.set(globalThis, 'DataTransfer', class {});
  Reflect.set(globalThis, 'ClipboardEvent', class {});
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  view?.destroy();
  view = null;
  // The slot is module state; a test that armed it must not arm the next one.
  takeImagePress();
  document.body.replaceChildren();
  Reflect.deleteProperty(globalThis, 'DataTransfer');
  Reflect.deleteProperty(globalThis, 'ClipboardEvent');
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: '', configurable: true });
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

  it('answers a plain caret press with the clipboard rows, cut and copy greyed', () => {
    allowPaste();
    rightClick(mount(null, 0).surface);
    expect(rows()).toEqual([
      { label: 'Cut', disabled: true },
      { label: 'Copy', disabled: true },
      { label: 'Paste', disabled: false },
    ]);
  });

  it('offers all three over a text range', () => {
    allowPaste();
    const mounted = mount(null, 0);
    act(() => {
      mounted.view.dispatch(
        mounted.view.state.tr.setSelection(TextSelection.create(mounted.view.state.doc, 2, 5)),
      );
    });
    rightClick(mounted.surface);
    expect(rows()).toEqual([
      { label: 'Cut', disabled: false },
      { label: 'Copy', disabled: false },
      { label: 'Paste', disabled: false },
    ]);
  });

  it('opens nothing on a caret press where the row cannot be offered', () => {
    // No clipboard to read, so the caret has nothing at all to answer with and a
    // menu of two dead rows would be worse than none.
    rightClick(mount(null, 0).surface);
    expect(rows()).toHaveLength(0);
  });

  it('carries paste onto a block selection, which a paste replaces', () => {
    allowPaste();
    const text = rightClick(mount(0).surface);
    expect(labels()).toContain('Paste');
    expect(text).toContain('MoveUp');
  });

  it('leaves paste off a picture, whose press selects nothing for it to land on', () => {
    allowPaste();
    const mounted = mount(null, null);
    recordImagePress({ pos: mounted.posOf(1), sid: mounted.sidOf(1) });
    rightClick(mounted.surface);
    expect(labels()).toContain('ImageCropReposition');
    expect(labels()).not.toContain('Paste');
  });

  it('leaves a right press on a marked word to the proofing card', () => {
    allowPaste();
    const mounted = mount(null, 0);
    const mark = mounted.markWord('prose');

    press(mark, 2);
    const event = contextMenu(mark);

    expect(rows()).toHaveLength(0);
    // Answered here, so the webview's own menu does not get it either.
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens over a marked word when a range is selected, because the verbs are the point', () => {
    allowPaste();
    const mounted = mount(null, 0);
    const mark = mounted.markWord('prose');
    act(() => {
      mounted.view.dispatch(
        mounted.view.state.tr.setSelection(TextSelection.create(mounted.view.state.doc, 2, 5)),
      );
    });

    press(mark, 2);
    contextMenu(mark);
    expect(labels()).toEqual(['Cut', 'Copy', 'Paste']);
  });

  it('reads the live selection when the keyboard asks, not the last press', () => {
    // Right click the picture, then move to the paragraph and ask from the
    // keyboard: the rows have to be the paragraph's, and its verbs run there.
    const mounted = mount(null, null);
    recordImagePress({ pos: mounted.posOf(1), sid: mounted.sidOf(1) });
    expect(rightClick(mounted.surface)).toContain('ImageCropReposition');

    act(() => {
      setBlockSelection(mounted.view, { selected: new Set([mounted.sidOf(0)]), anchorSid: mounted.sidOf(0) });
    });
    contextMenu(mounted.surface);

    expect(labels()).toContain('MoveUp');
    expect(labels()).not.toContain('ImageCropReposition');
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
