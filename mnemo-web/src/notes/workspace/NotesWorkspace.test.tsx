// @vitest-environment jsdom

/**
 * Checks library load failures, initial note selection, and keyboard search focus.
 */

import { StrictMode, act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoteSummaryDto } from '@/api/types';

import { installNativeKeyGuard } from '@/lib/native-keys';

import { NotesWorkspace } from './NotesWorkspace';
import { readLastNoteId, rememberLastNoteId } from './session';

// The export overlay pulls in pdf.js, which reaches for canvas APIs jsdom does
// not have, at import time. It renders nothing until it is opened and has no
// part in reading the library, so it is stood down for these tests.
vi.mock('../pdf/NotePdfExportOverlay', () => ({ NotePdfExportOverlay: () => null }));

// The workspace resolves its primary modifier once at import, so the host the suite
// runs on would otherwise decide which chord the case below presses.
vi.mock('@/keybinds/chord', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/keybinds/chord')>()),
  isMac: false,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
let mounted: boolean;
let client: QueryClient;
let fetchCalls: number;
/** What the next `/notes` and `/note-folders` read does. */
let reads: 'fail' | 'succeed';
/** What a successful `/notes` read answers with. */
let library: NoteSummaryDto[];

const realFetch = globalThis.fetch;

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

function withClient(node: ReactNode): ReactNode {
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function render(): void {
  act(() => root.render(<StrictMode>{withClient(<NotesWorkspace />)}</StrictMode>));
  mounted = true;
}

/**
 * Lets the queries settle and React paint what they settled to.
 *
 * Turns of the real event loop rather than a microtask drain: the query client
 * schedules through timers, so a promise flush alone leaves the tree loading.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function failure(): HTMLElement | null {
  return container.querySelector('[data-testid="tree-load-failed"]');
}

function retryButton(): HTMLButtonElement | null {
  const buttons = Array.from(failure()?.querySelectorAll('button') ?? []);
  return (buttons.find((b) => b.textContent?.includes('Retry')) as HTMLButtonElement | undefined) ?? null;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = false;
  fetchCalls = 0;
  reads = 'fail';
  library = [];
  localStorage.clear();
  window.location.hash = '';

  client = new QueryClient({
    // A retrying query never reaches the error state inside a test, and the
    // branch under test is the one after the retries have run out.
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  // Both reads answer with an empty list by default, which is the case that has
  // to stay distinguishable from a read that did not answer at all.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    fetchCalls += 1;
    if (reads === 'fail') throw new Error('offline');
    const url = String(input instanceof Request ? input.url : input);
    const body = url.endsWith('/notes') ? JSON.stringify(library) : '[]';
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  client.clear();
  globalThis.fetch = realFetch;
  localStorage.clear();
});

describe('a library that could not be read', () => {
  it('says so rather than drawing an empty tree', async () => {
    render();
    await settle();

    expect(failure()).not.toBeNull();
    expect(failure()?.textContent).toContain('ListErrorTitle');
    // Never the wording for a user who simply has no notes yet.
    expect(container.textContent).not.toContain('TreeEmpty');
  });

  it('offers a way back, and takes it', async () => {
    render();
    await settle();
    const before = fetchCalls;
    expect(retryButton()).not.toBeNull();

    reads = 'succeed';
    act(() => retryButton()?.click());
    await settle();

    expect(fetchCalls).toBeGreaterThan(before);
    expect(failure()).toBeNull();
  });

  it('does not send the reader to a sidebar that has nothing in it', async () => {
    render();
    await settle();

    // With no note open the pane would otherwise say "pick one from the sidebar",
    // which is not advice anyone can act on while the sidebar is the error.
    expect(container.textContent).not.toContain('NoNoteSelectedTitle');
  });
});

describe('the note the last visit was on', () => {
  it('is opened again once the library confirms it is still there', async () => {
    reads = 'succeed';
    library = [note('note-1')];
    rememberLastNoteId('note-1');

    render();
    await settle();

    expect(window.location.hash).toBe('#/notes/note-1');
  });

  it('leaves the empty state up, and is forgotten, when it has been deleted', async () => {
    reads = 'succeed';
    library = [note('note-1')];
    rememberLastNoteId('deleted');

    render();
    await settle();

    expect(window.location.hash).toBe('');
    expect(container.textContent).toContain('NoNoteSelectedTitle');
    expect(readLastNoteId()).toBeNull();
  });

  it('is left alone while the library is unreadable, so a bad read never forgets it', async () => {
    rememberLastNoteId('note-1');

    render();
    await settle();

    expect(window.location.hash).toBe('');
    expect(readLastNoteId()).toBe('note-1');
  });
});

describe('the print chord', () => {
  it('still focuses the search after the key guard has refused the engine', async () => {
    reads = 'succeed';
    render();
    await settle();

    // Set the platform explicitly because the guard reads it on each event.
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const disposeGuard = installNativeKeyGuard();
    // Run the scheduled focus callback synchronously in this test.
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      run(0);
      return 0;
    });

    try {
      const search = container.querySelector<HTMLInputElement>('input[placeholder="SearchPlaceholder"]');
      expect(search).not.toBeNull();

      // Dispatch inside the tree to exercise window capture before the workspace listener.
      const press = new KeyboardEvent('keydown', {
        key: 'p',
        code: 'KeyP',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        container.dispatchEvent(press);
      });

      expect(press.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(search);
    } finally {
      vi.unstubAllGlobals();
      disposeGuard();
    }
  });
});

describe('a library that read fine', () => {
  it('shows the tree, empty or not, and no failure', async () => {
    reads = 'succeed';
    render();
    await settle();

    expect(failure()).toBeNull();
    expect(container.textContent).toContain('TreeEmpty');
    // The counterpart to the check above: this wording is the one that belongs
    // to a working, empty library, so its absence there means something.
    expect(container.textContent).toContain('NoNoteSelectedTitle');
  });
});
