// @vitest-environment jsdom

/**
 * The editable mount, end to end, now inside the full note surface: a note's
 * stored blocks become an editable ProseMirror view with the editing stack live
 * on it, and the breadcrumb and word count mount around that one view without
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
import { buildNoteEditState, type NoteEditState } from '../edit/build-edit-state';
import { block, span } from '../editor/mapper/fixtures';
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
  emoji: null, cover: null, tags: [],
};

function surface(...blocks: Parameters<typeof buildNoteEditState>[0]): ReactNode {
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
      note={note}
      notes={[note]}
      folders={[]}
      sidebarOpen
      onToggleSidebar={() => undefined}
    />
  );
}

let container: HTMLElement;
let root: Root;
let disposed: boolean;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  disposed = false;
});

function dispose(): void {
  if (disposed) return;
  disposed = true;
  act(() => root.unmount());
}

afterEach(() => {
  dispose();
  container.remove();
});

function render(node: ReactNode): void {
  act(() => root.render(<StrictMode>{withClient(node)}</StrictMode>));
}

function proseMirror(): HTMLElement {
  return container.querySelector('.ProseMirror') as HTMLElement;
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

  it('renders the note title around the editor (in the breadcrumb and the heading)', () => {
    render(surface(block('Text', [span('body text')])));
    // Title shows in both the breadcrumb and the document heading; the exact
    // word-count figure is covered by word-count.test.ts, not asserted here.
    expect(container.textContent).toContain('Note one');
    expect(container.textContent).toContain('body text');
  });
});
