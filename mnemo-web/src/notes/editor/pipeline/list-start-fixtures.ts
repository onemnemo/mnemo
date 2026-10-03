/** Shared builders and probes for the numbered-list start tests. */

import { expect } from 'vitest';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode, Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { undo, redo } from '../history';
import { moveBlockTransaction } from '../chrome/block-move';
import { stashSlice } from '../../clipboard/internal-buffer';
import { MNEMO_CLIPBOARD_MIME } from '../../clipboard/write-clipboard';
import { blockSelectionKey } from '../../selection/block-selection-plugin';
import { storedListStart } from '../blocks/list-start';
import { listNumberDecorations } from './list-numbers';
import type { Block } from '../../model/types';

export function numbered(text: string, start?: number, children: Block[] | null = null): Block {
  return block('NumberedList', [span(text)], { kind: 'empty' }, {
    meta: start === undefined ? {} : { listStart: start },
    children,
  });
}

export function text(value: string): Block {
  return block('Text', [span(value)]);
}

/** What `# Steps\n\n8. eight\n9. nine\n10. ten` imports as on the host and through paste. */
export function eightNineTen(): Block[] {
  return [numbered('eight', 8), numbered('nine'), numbered('ten')];
}

export function mount(blocks: Block[]): ReturnType<typeof buildNoteEditState> & { ok: true } {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  return built;
}

/** The label every numbered item shows, in document order. */
export function labels(state: EditorState): string[] {
  return listNumberDecorations(state.doc).map(
    (d) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs['data-list-number'],
  );
}

/** The text of every block that stores a start, with the start. */
export function starts(state: EditorState): Record<string, number> {
  const found: Record<string, number> = {};
  state.doc.descendants((node) => {
    const start = node.isTextblock ? null : storedListStart(node.attrs.meta);
    if (start !== null) found[node.firstChild?.textContent ?? ''] = start;
    return !node.isTextblock;
  });
  return found;
}

export function itemAt(state: EditorState, value: string): { pos: number; node: PMNode } {
  let found: { pos: number; node: PMNode } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isTextblock && node.firstChild?.isTextblock && node.firstChild.textContent === value) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  if (!found) throw new Error(`no block "${value}"`);
  return found;
}

export function indexOf(state: EditorState, value: string): number {
  const { pos } = itemAt(state, value);
  return state.doc.resolve(pos).index(0);
}

export function run(
  state: EditorState,
  command: (s: EditorState, d: (tr: Transaction) => void) => boolean,
): EditorState {
  let next = state;
  expect(command(state, (tr) => (next = state.apply(tr)))).toBe(true);
  return next;
}

export function caretIn(state: EditorState, value: string, offset: number): EditorState {
  const { pos } = itemAt(state, value);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos + 2 + offset)));
}

export function move(state: EditorState, from: string, to: number): EditorState {
  return state.apply(moveBlockTransaction(state, indexOf(state, from), to)!);
}

/** Undo puts back exactly what was there, and redo exactly what the edit made. */
export function expectUndoRedo(before: EditorState, after: EditorState): void {
  const undone = run(after, undo);
  expect(undone.doc.eq(before.doc)).toBe(true);
  expect(labels(undone)).toEqual(labels(before));
  expect(starts(undone)).toEqual(starts(before));
  const redone = run(undone, redo);
  expect(redone.doc.eq(after.doc)).toBe(true);
  expect(labels(redone)).toEqual(labels(after));
}

export function bufferedClipboard(copy: { slice: Slice; mode: 'blocks' | 'text' }): DataTransfer {
  const store = new Map<string, string>();
  const nonce = stashSlice(copy.slice, copy.mode);
  store.set(MNEMO_CLIPBOARD_MIME, JSON.stringify({ v: 1, nonce, mode: copy.mode, slice: copy.slice.toJSON() }));
  return {
    setData: (type: string, data: string) => store.set(type, data),
    getData: (type: string) => store.get(type) ?? '',
  } as unknown as DataTransfer;
}

export function viewOf(get: () => EditorState, set: (s: EditorState) => void): EditorView {
  return {
    get state() {
      return get();
    },
    isDestroyed: false,
    dispatch(tr: Transaction) {
      set(get().apply(tr));
    },
  } as unknown as EditorView;
}

export function selectBlocks(state: EditorState, sids: string[]): EditorState {
  return state.apply(
    state.tr.setMeta(blockSelectionKey, { type: 'set', selection: { selected: new Set(sids), anchorSid: sids[0] } }),
  );
}
