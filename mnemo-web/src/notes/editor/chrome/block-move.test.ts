// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { EditorState } from 'prosemirror-state';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { undo } from '../history';
import { moveBlockTransaction } from './block-move';

type Blocks = Parameters<typeof buildNoteEditState>[0];

function mount(blocks: Blocks): EditorState {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  return built.state;
}

/** The first text span of each top-level block, in document order. */
function order(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.forEach((node) => out.push(node.textContent));
  return out;
}

function sids(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.forEach((node) => out.push(String(node.attrs.sid)));
  return out;
}

function threeBlocks(): EditorState {
  return mount([
    block('Text', [span('one')]),
    block('Text', [span('two')]),
    block('Text', [span('three')]),
  ]);
}

describe('moveBlockTransaction', () => {
  it('moves a block forward to the end', () => {
    const state = threeBlocks();
    const tr = moveBlockTransaction(state, 0, 2);
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(order(next)).toEqual(['two', 'three', 'one']);
  });

  it('moves a block backward to the front', () => {
    const state = threeBlocks();
    const next = state.apply(moveBlockTransaction(state, 2, 0)!);
    expect(order(next)).toEqual(['three', 'one', 'two']);
  });

  it('carries the moved block sid across the move', () => {
    const state = threeBlocks();
    const before = sids(state);
    const next = state.apply(moveBlockTransaction(state, 0, 2)!);
    // The block that was first is now last, still under its original sid.
    expect(sids(next)).toEqual([before[1], before[2], before[0]]);
  });

  it('is one undo step: a single undo restores the whole order', () => {
    const state = threeBlocks();
    const moved = state.apply(moveBlockTransaction(state, 0, 2)!);
    expect(order(moved)).toEqual(['two', 'three', 'one']);

    let restored = moved;
    undo(moved, (tr) => {
      restored = moved.apply(tr);
    });
    expect(order(restored)).toEqual(['one', 'two', 'three']);
  });

  it('rejects an out-of-range or no-op move', () => {
    const state = threeBlocks();
    expect(moveBlockTransaction(state, 1, 1)).toBeNull();
    expect(moveBlockTransaction(state, -1, 0)).toBeNull();
    expect(moveBlockTransaction(state, 3, 0)).toBeNull();
    expect(moveBlockTransaction(state, 0, 3)).toBeNull();
  });
});
