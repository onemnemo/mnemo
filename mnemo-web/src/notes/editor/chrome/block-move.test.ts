// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { EditorState } from 'prosemirror-state';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { undo } from '../history';
import { extractBlockTransaction, moveBlockTransaction } from './block-move';

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

/** [one] [twoColumn: left(a, b) | right(c)] - a nested run beside a lone cell child. */
function columnDoc(): EditorState {
  return mount([
    block('Text', [span('one')]),
    block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
      children: [
        block('ColumnGroup', [span('')], { kind: 'empty' }, {
          children: [block('Text', [span('a')]), block('Text', [span('b')])],
        }),
        block('ColumnGroup', [span('')], { kind: 'empty' }, {
          children: [block('Text', [span('c')])],
        }),
      ],
    }),
  ]);
}

/** Position and sid of the first paragraph whose text is `text`, at any depth. */
function findParagraph(state: EditorState, text: string): { pos: number; sid: string } {
  let found: { pos: number; sid: string } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'paragraph' && node.textContent === text) {
      found = { pos, sid: String(node.attrs.sid) };
      return false;
    }
    return true;
  });
  if (!found) throw new Error(`no paragraph "${text}"`);
  return found;
}

describe('extractBlockTransaction', () => {
  it('moves a cell child to a top-level gap, sid intact', () => {
    const state = columnDoc();
    const target = findParagraph(state, 'a');
    const next = state.apply(extractBlockTransaction(state, target.pos, target.sid, 0)!);
    expect(order(next)).toEqual(['a', 'one', 'bc']);
    expect(String(next.doc.child(0).attrs.sid)).toBe(target.sid);
    // The cell keeps its remaining child.
    expect(findParagraph(next, 'b').pos).toBeGreaterThan(0);
  });

  it('reseeds an emptied cell through the column-repair invariant, in the same step', () => {
    const state = columnDoc();
    const target = findParagraph(state, 'c');
    const next = state.apply(extractBlockTransaction(state, target.pos, target.sid, 2)!);
    expect(order(next)).toEqual(['one', 'ab', 'c']);
    // The right cell was emptied and repaired with a placeholder paragraph.
    const rightCell = next.doc.child(1).child(2);
    expect(rightCell.type.name).toBe('columnGroup');
    const children: string[] = [];
    rightCell.forEach((child) => {
      if (child.type.name === 'paragraph') children.push(child.textContent);
    });
    expect(children).toEqual(['']);
  });

  it('is one undo step, repair included', () => {
    const state = columnDoc();
    const target = findParagraph(state, 'c');
    const moved = state.apply(extractBlockTransaction(state, target.pos, target.sid, 2)!);
    let restored = moved;
    undo(moved, (tr) => {
      restored = moved.apply(tr);
    });
    expect(order(restored)).toEqual(['one', 'abc']);
    expect(findParagraph(restored, 'c').sid).toBe(target.sid);
  });

  it('refuses a stale position, a top-level source, and an out-of-range gap', () => {
    const state = columnDoc();
    const target = findParagraph(state, 'a');
    expect(extractBlockTransaction(state, target.pos, 'not-the-sid', 0)).toBeNull();
    expect(extractBlockTransaction(state, 0, String(state.doc.child(0).attrs.sid), 1)).toBeNull();
    expect(extractBlockTransaction(state, target.pos, target.sid, 5)).toBeNull();
  });
});
