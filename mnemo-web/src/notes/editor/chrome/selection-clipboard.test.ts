// @vitest-environment jsdom

/**
 * The menu's clipboard verbs, and above all what paste is allowed to do.
 *
 * Two things are pinned about it. The row is drawn only where a clipboard read
 * is answered without asking the reader, which is a property of the engine and
 * not of the machine a test runs on, so the platform is set here rather than
 * read. And the content reaches the document as a paste event on the editor's
 * own node, so the pipeline behind Ctrl+V is the one that places it; a second
 * insertion path here would drift from it.
 */

import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { blockSelectionKey } from '../../selection/block-selection-plugin';
import { block, span } from '../mapper/fixtures';
import { canPasteFromMenu, hasClipboardSelection, runPasteVerb } from './selection-clipboard';

/** jsdom carries neither, and the engines this ships on carry both. */
class FakeTransfer {
  private readonly store = new Map<string, string>();
  readonly files: File[] = [];
  readonly items = { add: (file: File) => void this.files.push(file) };
  setData(type: string, value: string): void {
    this.store.set(type, value);
  }
  getData(type: string): string {
    return this.store.get(type) ?? '';
  }
  clearData(): void {
    this.store.clear();
  }
}

class FakeClipboardEvent extends Event {
  readonly clipboardData: FakeTransfer;
  constructor(type: string, init: EventInit & { clipboardData: FakeTransfer }) {
    super(type, init);
    this.clipboardData = init.clipboardData;
  }
}

const built = (() => {
  const result = buildNoteEditState([block('Text', [span('one')]), block('Text', [span('two')])]);
  if (!result.ok) throw new Error('fixture did not build');
  return result;
})();

function mount(): EditorState {
  return built.state;
}

/** A text range over the first block's word. */
function ranged(state: EditorState): EditorState {
  const tr = state.tr;
  return state.apply(tr.setSelection(TextSelection.create(tr.doc, 1, 4)));
}

function blockSelected(state: EditorState, sids: string[]): EditorState {
  return state.apply(
    state.tr.setMeta(blockSelectionKey, {
      type: 'set',
      selection: { selected: new Set(sids), anchorSid: sids[0] ?? null },
    }),
  );
}

const views: EditorView[] = [];

function setPlatform(platform: string): void {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
}

/** What `navigator.clipboard.read()` answers with, one item carrying every type. */
function setClipboard(entries: readonly (readonly [string, string])[] | null): void {
  const value =
    entries === null
      ? undefined
      : {
          read: () =>
            Promise.resolve([
              {
                types: entries.map(([type]) => type),
                getType: (type: string) => {
                  const found = entries.find(([candidate]) => candidate === type);
                  return found
                    ? Promise.resolve(new Blob([found[1]], { type }))
                    : Promise.reject(new Error('no such type'));
                },
              },
            ]),
        };
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

function setRefusedClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { read: () => Promise.reject(new Error('denied')) },
    configurable: true,
  });
}

/** A window that answers a clipboard read itself, which is what the shipped ones do. */
function permissive(): void {
  setPlatform('Win32');
  Reflect.set(globalThis, 'DataTransfer', FakeTransfer);
  Reflect.set(globalThis, 'ClipboardEvent', FakeClipboardEvent);
}

/** The editor as it really is, so a paste lands through the whole pipeline. */
function fullView(): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, { state: built.state });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  views.push(view);
  return view;
}

/** A view whose only plugin records the paste event, so the transfer can be read off it. */
function probeView(): { view: EditorView; seen: FakeTransfer[] } {
  const seen: FakeTransfer[] = [];
  const probe = new Plugin({
    props: {
      handlePaste(_view, event) {
        seen.push(event.clipboardData as unknown as FakeTransfer);
        return true;
      },
    },
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, {
    state: EditorState.create({ schema: built.state.schema, doc: built.state.doc, plugins: [probe] }),
  });
  views.push(view);
  return { view, seen };
}

const docText = (view: EditorView) => view.state.doc.textBetween(0, view.state.doc.content.size, ' ');

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  Reflect.deleteProperty(globalThis, 'DataTransfer');
  Reflect.deleteProperty(globalThis, 'ClipboardEvent');
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  setPlatform('');
});

describe('hasClipboardSelection', () => {
  it('is false on a bare caret', () => {
    expect(hasClipboardSelection(mount())).toBe(false);
  });

  it('is true on a text range', () => {
    expect(hasClipboardSelection(ranged(mount()))).toBe(true);
  });

  it('is false on a block selection, whose DOM caret is collapsed', () => {
    const state = mount();
    expect(hasClipboardSelection(blockSelected(state, [String(state.doc.child(0).attrs.sid)]))).toBe(false);
  });
});

describe('canPasteFromMenu', () => {
  it('offers the row where the window answers the read itself', () => {
    permissive();
    setClipboard([]);
    expect(canPasteFromMenu()).toBe(true);
  });

  it('withholds it on Apple platforms, where the engine asks with its own paste button', () => {
    permissive();
    setClipboard([]);
    setPlatform('MacIntel');
    expect(canPasteFromMenu()).toBe(false);
  });

  it('withholds it where the engine has no clipboard to read', () => {
    permissive();
    setClipboard(null);
    expect(canPasteFromMenu()).toBe(false);
  });
});

describe('runPasteVerb', () => {
  it('carries every usable type the clipboard answered with', async () => {
    permissive();
    setClipboard([
      ['text/plain', 'plain words'],
      ['text/html', '<p>rich words</p>'],
      ['image/png', 'not really png'],
      ['text/rtf', 'nothing reads this'],
    ]);
    const { view, seen } = probeView();

    expect(await runPasteVerb(view)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].getData('text/plain')).toBe('plain words');
    expect(seen[0].getData('text/html')).toBe('<p>rich words</p>');
    expect(seen[0].files.map((file) => file.type)).toEqual(['image/png']);
    expect(seen[0].getData('text/rtf')).toBe('');
  });

  it('places what it read through the paste handling the editor already has', async () => {
    permissive();
    setClipboard([['text/plain', 'pasted']]);
    const view = fullView();

    expect(await runPasteVerb(view)).toBe(true);
    expect(docText(view)).toContain('pasted');
  });

  it('leaves the document alone when the read is refused', async () => {
    permissive();
    setRefusedClipboard();
    const view = fullView();
    const before = docText(view);

    expect(await runPasteVerb(view)).toBe(false);
    expect(docText(view)).toBe(before);
  });

  it('dispatches nothing when the clipboard holds nothing a handler could use', async () => {
    permissive();
    setClipboard([['text/rtf', 'nothing reads this']]);
    const { view, seen } = probeView();

    expect(await runPasteVerb(view)).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
