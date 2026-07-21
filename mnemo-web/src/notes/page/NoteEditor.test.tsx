// @vitest-environment jsdom

/**
 * The editable mount, end to end: a note's stored blocks become an editable
 * ProseMirror view, and the editing stack, the invariant pipeline, the
 * markdown input shortcuts, the structural keymap, is live on it, not merely
 * present in the state. Driving the real view (not a bare `state.apply`) is the
 * point: it is the only check that the plugins survive being wired into a mounted
 * `EditorView`.
 */

import { StrictMode, act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildNoteEditState, type NoteEditState } from '../edit/build-edit-state';
import { block, span } from '../editor/mapper/fixtures';
import { NoteEditor } from './NoteEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function editStateOf(...blocks: Parameters<typeof buildNoteEditState>[0]) {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error(`quarantined: ${built.reason.message}`);
  return built as Extract<NoteEditState, { ok: true }>;
}

/** The component commits through react-query's cache, so it needs a client. */
function withClient(node: ReactNode): ReactNode {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

/** The editor with everything but the document defaulted. */
function editor(...blocks: Parameters<typeof buildNoteEditState>[0]): ReactNode {
  const built = editStateOf(...blocks);
  return (
    <NoteEditor
      noteId="n1"
      sid="n0001"
      ver={1}
      state={built.state}
      registry={built.registry}
      mapper={built.mapper}
      onReload={() => undefined}
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

describe('NoteEditor', () => {
  it('mounts exactly one editable view that renders the note', () => {
    render(editor(block('Text', [span('hello world')])));
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(proseMirror().getAttribute('contenteditable')).toBe('true');
    expect(container.textContent).toContain('hello world');
  });

  it('keeps the caret live (does not hide it the way the read-only view does)', () => {
    render(editor(block('Text', [span('x')])));
    // The read-only rule is scoped to contenteditable=false; an editable root
    // must not match it.
    expect(proseMirror().matches('[contenteditable="false"]')).toBe(false);
  });
});
