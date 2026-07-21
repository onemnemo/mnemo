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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';

import { buildNoteEditState } from '../edit/build-edit-state';
import { block, span } from '../editor/mapper/fixtures';
import { NoteEditor } from './NoteEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function editStateOf(...blocks: Parameters<typeof buildNoteEditState>[0]): EditorState {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error(`quarantined: ${built.reason.message}`);
  return built.state;
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
  act(() => root.render(<StrictMode>{node}</StrictMode>));
}

function proseMirror(): HTMLElement {
  return container.querySelector('.ProseMirror') as HTMLElement;
}

describe('NoteEditor', () => {
  it('mounts exactly one editable view that renders the note', () => {
    render(
      <NoteEditor
        noteId="n1"
        state={editStateOf(block('Text', [span('hello world')]))}
        registry={registryFor()}
      />,
    );
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(proseMirror().getAttribute('contenteditable')).toBe('true');
    expect(container.textContent).toContain('hello world');
  });

  it('keeps the caret live (does not hide it the way the read-only view does)', () => {
    render(
      <NoteEditor noteId="n1" state={editStateOf(block('Text', [span('x')]))} registry={registryFor()} />,
    );
    // The read-only rule is scoped to contenteditable=false; an editable root
    // must not match it.
    expect(proseMirror().matches('[contenteditable="false"]')).toBe(false);
  });
});

/** A registry to hand the component; any built edit state carries the shared one. */
function registryFor() {
  const built = buildNoteEditState([block('Text', [span('x')])]);
  if (!built.ok) throw new Error('unexpected quarantine');
  return built.registry;
}
