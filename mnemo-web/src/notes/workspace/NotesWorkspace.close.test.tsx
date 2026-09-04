// @vitest-environment jsdom

/**
 * What the tab menu's verbs do once they are run through the real workspace:
 * where the pane lands and what the store is left holding when a close verb
 * takes a whole row of tabs down, and which note the peek is handed.
 *
 * The strip renders only the open ids the library has named, so these run the
 * verbs through the real workspace rather than the pure rules alone: the note
 * that is open is usually one of the ones being closed, and the store can be
 * holding ids inside the same range that no tab was showing.
 */

import { StrictMode, act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoteSummaryDto } from '@/api/types';
import { usePeekStore } from '@/peek/store';

import { NotesWorkspace } from './NotesWorkspace';
import { useNoteTabs } from './tabs';

// Both pull in weight this has no use for: the export overlay reaches for canvas
// APIs jsdom has none of at import time, and the pane mounts a whole editor.
vi.mock('../pdf/NotePdfExportOverlay', () => ({ NotePdfExportOverlay: () => null }));
vi.mock('./NotePane', () => ({ NotePane: () => null }));

vi.mock('@/keybinds/chord', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/keybinds/chord')>()),
  isMac: false,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realFetch = globalThis.fetch;

let container: HTMLElement;
let root: Root;
let mounted: boolean;
let client: QueryClient;
/** The notes the library answers with; anything open but missing here gets no tab. */
let library: NoteSummaryDto[];

function note(id: string): NoteSummaryDto {
  return {
    id,
    sid: id,
    ver: 1,
    title: id,
    folderId: null,
    parentNoteId: null,
    order: 0,
    isFavorite: false,
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
    emoji: null,
    cover: null,
    coverCrop: null,
    tags: [],
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function withClient(node: ReactNode): ReactNode {
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

/** Lets the queries settle through their timers and React paint what they settled to. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function open(openIds: string[], noteId: string): Promise<void> {
  useNoteTabs.setState({ ids: openIds });
  act(() => root.render(<StrictMode>{withClient(<NotesWorkspace noteId={noteId} />)}</StrictMode>));
  mounted = true;
  await settle();
}

function tabElements(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
}

function tabFor(id: string): HTMLElement {
  const element = tabElements().find((el) => el.dataset.tabId === id);
  expect(element, `no tab for ${id}`).toBeDefined();
  return element!;
}

/** With no bundle loaded, every label is its own key. */
function chooseFromMenu(tabId: string, key: string): void {
  act(() => {
    tabFor(tabId).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === key);
  expect(item, `no menu item labelled ${key}`).toBeDefined();
  act(() => item!.click());
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = false;
  library = ['note-1', 'note-2', 'note-3', 'note-4'].map(note);
  localStorage.clear();
  window.location.hash = '';
  useNoteTabs.setState({ ids: [] });
  usePeekStore.setState({ item: null });

  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/notes')) return json(library);
    if (url.endsWith('/note-folders')) return json([]);
    return json({ ...note('note-1'), blocks: [] });
  }) as typeof fetch;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  client.clear();
  globalThis.fetch = realFetch;
  localStorage.clear();
  useNoteTabs.setState({ ids: [] });
  usePeekStore.setState({ item: null });
});

describe('closing a row of tabs', () => {
  it('lands on the tab that was kept, not on the neighbour that went with the rest', async () => {
    await open(['note-1', 'note-2', 'note-3', 'note-4'], 'note-1');
    expect(tabElements().length).toBe(4);

    chooseFromMenu('note-3', 'CloseOtherTabs');
    await settle();

    // Stepping one place from note-1 would open note-2, which this just closed.
    expect(window.location.hash).toBe('#/notes/note-3');
    expect(useNoteTabs.getState().ids).toEqual(['note-3']);
  });

  it('falls back to the nearest tab still standing on one side', async () => {
    await open(['note-1', 'note-2', 'note-3', 'note-4'], 'note-4');

    chooseFromMenu('note-2', 'CloseTabsToTheRight');
    await settle();

    expect(window.location.hash).toBe('#/notes/note-2');
    expect(useNoteTabs.getState().ids).toEqual(['note-1', 'note-2']);
  });

  it('leaves the note that is open alone when the range does not reach it', async () => {
    await open(['note-1', 'note-2', 'note-3', 'note-4'], 'note-1');

    chooseFromMenu('note-3', 'CloseTabsToTheRight');
    await settle();

    expect(window.location.hash).toBe('');
    expect(useNoteTabs.getState().ids).toEqual(['note-1', 'note-2', 'note-3']);
  });

  it('takes the open ids inside the range that had no tab of their own', async () => {
    // 'ghost' is open but the library never names it, so nothing renders for it.
    await open(['note-1', 'ghost', 'note-2', 'note-3'], 'note-1');
    expect(tabElements().map((el) => el.dataset.tabId)).toEqual(['note-1', 'note-2', 'note-3']);

    chooseFromMenu('note-3', 'CloseTabsToTheLeft');
    await settle();

    // Left behind, 'ghost' would become a tab the moment the library named it.
    expect(useNoteTabs.getState().ids).toEqual(['note-3']);
    expect(window.location.hash).toBe('#/notes/note-3');
  });
});

describe('opening a tab in the side peek', () => {
  it('hands the peek the note the menu was raised on, not the one that is open', async () => {
    await open(['note-1', 'note-2', 'note-3'], 'note-1');

    chooseFromMenu('note-2', 'OpenInSidePeek');
    await settle();

    expect(usePeekStore.getState().item).toEqual({ kind: 'note', id: 'note-2' });
    // Peeking is a second view, not a navigation: the tab stays where it was.
    expect(window.location.hash).toBe('');
    expect(useNoteTabs.getState().ids).toEqual(['note-1', 'note-2', 'note-3']);
  });
});
