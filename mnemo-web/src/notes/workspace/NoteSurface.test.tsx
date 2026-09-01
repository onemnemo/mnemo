// @vitest-environment jsdom

/**
 * The editable mount, end to end, now inside the full note surface: a note's
 * stored blocks become an editable ProseMirror view with the editing stack live
 * on it, and the heading and word count mount around that one view without
 * tearing it down. Driving the real view (not a bare `state.apply`) is the
 * point: it is the only check the plugins survive being wired into a mounted
 * `EditorView`.
 */

import { StrictMode, act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NoteSummaryDto } from '@/api/types';
import { useImageEditorStore } from '@/components/ui/image-editor/store';
import { useSettingsStore } from '@/settings/store';
import { buildNoteEditState, type NoteEditState } from '../edit/build-edit-state';
import { block, span } from '../editor/mapper/fixtures';
import { COVER_BANNER_HEIGHT } from './NoteHeaderChrome';
import { NoteSurface } from './NoteSurface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function editStateOf(...blocks: Parameters<typeof buildNoteEditState>[0]) {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error(`quarantined: ${built.reason.message}`);
  return built as Extract<NoteEditState, { ok: true }>;
}

function withClient(node: ReactNode): ReactNode {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

const note: NoteSummaryDto = {
  id: 'n1', sid: 'n0001', ver: 1, title: 'Note one', folderId: null, parentNoteId: null,
  order: 0, isFavorite: false, createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-01T00:00:00Z',
  emoji: null, cover: null, coverCrop: null, tags: [],
};

function surfaceOf(over: Partial<NoteSummaryDto>, blocks: Parameters<typeof buildNoteEditState>[0]): ReactNode {
  const built = editStateOf(...blocks);
  return (
    <NoteSurface
      noteId="n1"
      sid="n0001"
      ver={1}
      state={built.state}
      registry={built.registry}
      mapper={built.mapper}
      onReload={() => undefined}
      note={{ ...note, ...over }}
    />
  );
}

function surface(...blocks: Parameters<typeof buildNoteEditState>[0]): ReactNode {
  return surfaceOf({}, blocks);
}

let container: HTMLElement;
let root: Root;
let disposed: boolean;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  disposed = false;
  useSettingsStore.setState({ values: {}, loaded: true });
  useImageEditorStore.setState({ pending: null });
});

function dispose(): void {
  if (disposed) return;
  disposed = true;
  act(() => root.unmount());
}

afterEach(() => {
  dispose();
  container.remove();
  useSettingsStore.setState({ values: {}, loaded: false });
});

function autosave(on: boolean): void {
  useSettingsStore.setState({ values: { 'Editor.AutoSave': on }, loaded: true });
}

/** The save chrome, or null when it has decided to stay quiet. */
function saveState(): HTMLElement | null {
  return container.querySelector('[data-testid="save-state"]');
}

/**
 * One real edit, through the keymap on the mounted view.
 *
 * Enter rather than a character: text insertion in a browser arrives as a DOM
 * mutation the view reads back, which jsdom does not produce, while a bound key
 * runs the command and dispatches for real.
 */
function edit(): void {
  act(() => {
    proseMirror().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Enter', key: 'Enter' }),
    );
  });
}

function render(node: ReactNode): void {
  act(() => root.render(<StrictMode>{withClient(node)}</StrictMode>));
}

function proseMirror(): HTMLElement {
  return container.querySelector('.ProseMirror') as HTMLElement;
}

/** Which way the document column padded itself, which is the whole cover layout branch. */
function headerPadding(): string {
  const column = container.querySelector('div.px-14') as HTMLElement;
  return column.classList.contains('pt-0') ? 'pt-0' : 'pt-10';
}

/** A button anywhere on the page by its label, which is the i18n key on an empty bundle. */
function button(label: string): HTMLButtonElement | null {
  const found = [...document.querySelectorAll('button')].find((el) => (el.textContent ?? '').trim() === label);
  return (found as HTMLButtonElement | undefined) ?? null;
}

function click(target: Element | null): void {
  expect(target).not.toBeNull();
  act(() => {
    (target as HTMLElement).click();
  });
}

/** jsdom lays nothing out, so clientWidth is always 0 unless a test says otherwise. */
function withClientWidth(width: number, body: () => void): void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  try {
    body();
  } finally {
    if (original === undefined) delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    else Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
  }
}

describe('NoteSurface', () => {
  it('mounts exactly one editable view that renders the note', () => {
    render(surface(block('Text', [span('hello world')])));
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(proseMirror().getAttribute('contenteditable')).toBe('true');
    expect(container.textContent).toContain('hello world');
  });

  it('keeps the caret live (does not hide it the way the read-only view does)', () => {
    render(surface(block('Text', [span('x')])));
    expect(proseMirror().matches('[contenteditable="false"]')).toBe(false);
  });

  it('renders the note title as the document heading around the editor', () => {
    render(surface(block('Text', [span('body text')])));
    // Title shows in the document heading; the breadcrumb now lives in the shared
    // topbar, and the exact word-count figure is covered by word-count.test.ts.
    expect(container.textContent).toContain('Note one');
    expect(container.textContent).toContain('body text');
  });

  it('pads the header down when the note has no cover', () => {
    render(surface(block('Text', [span('x')])));
    expect(headerPadding()).toBe('pt-10');
  });

  it('lifts the header under a preset cover', () => {
    render(surfaceOf({ cover: 'sunset' }, [block('Text', [span('x')])]));
    expect(headerPadding()).toBe('pt-0');
  });

  it('takes the same branch for an uploaded cover as for a preset', () => {
    // A cover token is opaque: layout that only recognises the presets lays an uploaded
    // cover out as if the note had none, and the header lands on top of the banner.
    render(surfaceOf({ cover: 'asset:abcd.png' }, [block('Text', [span('x')])]));
    expect(headerPadding()).toBe('pt-0');
  });
});

describe('the save chrome', () => {
  it('says nothing about a note that has only been opened', () => {
    autosave(false);
    render(surface(block('Text', [span('x')])));
    expect(saveState()).toBeNull();
  });

  it('calls an edited note unsaved when the user owns the saving', () => {
    autosave(false);
    render(surface(block('Text', [span('x')])));
    edit();
    expect(saveState()?.dataset.saveState).toBe('dirty');
    expect(saveState()?.textContent).toContain('SaveStateUnsaved');
  });

  it('stays out of the way while autosave owns the saving', () => {
    autosave(true);
    render(surface(block('Text', [span('x')])));
    edit();
    expect(saveState()).toBeNull();
  });

  it('defaults to autosave on, so an unconfigured install is not narrated at', () => {
    // No stored value: the schema default is on, and reading a missing setting as
    // off would put the chrome on screen for everyone who never opened settings.
    render(surface(block('Text', [span('x')])));
    edit();
    expect(saveState()).toBeNull();
  });

  it('says unsaved once, not once per keystroke', () => {
    autosave(false);
    render(surface(block('Text', [span('x')])));
    edit();
    const first = saveState();
    edit();
    edit();
    // The same element, still saying the same thing: the state does not churn
    // under typing, so there is nothing to flicker.
    expect(saveState()).toBe(first);
    expect(saveState()?.dataset.saveState).toBe('dirty');
  });

  it('speaks up as soon as autosave is switched off under a note already edited', () => {
    // The change sitting unsaved when the switch flips is exactly the one at
    // risk, so the chrome has to report on it rather than wait for the next edit.
    autosave(true);
    render(surface(block('Text', [span('x')])));
    edit();
    expect(saveState()).toBeNull();

    act(() => autosave(false));
    expect(saveState()?.dataset.saveState).toBe('dirty');
  });

  it('goes quiet again when autosave is switched back on', () => {
    autosave(false);
    render(surface(block('Text', [span('x')])));
    edit();
    expect(saveState()).not.toBeNull();

    act(() => autosave(true));
    expect(saveState()).toBeNull();
  });

  it('sits before the pane actions, which stay anchored as the wording changes length', () => {
    autosave(false);
    render(surface(block('Text', [span('x')])));
    edit();
    const row = saveState()?.parentElement;
    expect(row?.className).toContain('right-3');
    // Last in a right-anchored row means the actions keep their place and the
    // label grows leftwards into empty chrome instead of pushing anything.
    expect(row?.lastElementChild).not.toBe(saveState());
  });
});

describe('the cover editor aspect', () => {
  afterEach(() => {
    useImageEditorStore.setState({ pending: null });
  });

  it('frames a first-ever cover against the scroller itself, not the 30/7 fallback', () => {
    // No cover has ever been set, so CoverBanner has never rendered and never measured a
    // width: the picker used to see that as "unmeasurable" and open the editor at a fixed
    // ratio instead of the pane's own real band.
    withClientWidth(860, () => {
      render(surface(block('Text', [span('x')])));
      click(button('AddCover'));
      click(button('UploadCover'));

      expect(useImageEditorStore.getState().pending?.aspect).toBeCloseTo(860 / COVER_BANNER_HEIGHT);
    });
  });
});
