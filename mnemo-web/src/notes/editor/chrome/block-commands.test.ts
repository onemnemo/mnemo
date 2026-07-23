// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { createEditorSchema } from '../schema';
import { block, span } from '../mapper/fixtures';
import type { BlockRegistry } from '../registry/build';
import {
  canTurnInto,
  deleteBlock,
  duplicateBlock,
  locateBlock,
  moveBlockDown,
  moveBlockUp,
  turnInto,
  TURN_INTO_OPTIONS,
  type BlockLocation,
} from './block-commands';

type Blocks = Parameters<typeof buildNoteEditState>[0];

function mount(blocks: Blocks): { state: EditorState; registry: BlockRegistry } {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  return { state: built.state, registry: built.registry };
}

function order(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.forEach((node) => out.push(node.textContent));
  return out;
}

function types(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.forEach((node) => out.push(node.type.name));
  return out;
}

function sids(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.forEach((node) => out.push(String(node.attrs.sid)));
  return out;
}

/** Location of the top-level block at child `index`. */
function topLocation(state: EditorState, registry: BlockRegistry, index: number): BlockLocation {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  const node = state.doc.child(index);
  const loc = locateBlock(state, registry, pos, String(node.attrs.sid ?? ''));
  if (!loc) throw new Error('block did not locate');
  return loc;
}

function three(): { state: EditorState; registry: BlockRegistry } {
  return mount([
    block('Text', [span('one')]),
    block('Text', [span('two')]),
    block('Text', [span('three')]),
  ]);
}

describe('locateBlock', () => {
  it('finds the block again by sid when the position went stale', () => {
    const { state, registry } = three();
    const second = topLocation(state, registry, 1);
    // A deliberately wrong position with the right sid still resolves.
    const relocated = locateBlock(state, registry, 0, String(second.node.attrs.sid));
    expect(relocated?.pos).toBe(second.pos);
    expect(relocated?.node.textContent).toBe('two');
  });

  it('reports sibling context: edges have no prev/next', () => {
    const { state, registry } = three();
    const first = topLocation(state, registry, 0);
    const last = topLocation(state, registry, 2);
    expect(first.prev).toBeNull();
    expect(first.next?.node.textContent).toBe('two');
    expect(last.prev?.node.textContent).toBe('two');
    expect(last.next).toBeNull();
  });
});

describe('move commands', () => {
  it('move up is null at the top and swaps otherwise', () => {
    const { state, registry } = three();
    expect(moveBlockUp(state, topLocation(state, registry, 0))).toBeNull();
    const next = state.apply(moveBlockUp(state, topLocation(state, registry, 1))!);
    expect(order(next)).toEqual(['two', 'one', 'three']);
  });

  it('move down is null at the bottom and swaps otherwise', () => {
    const { state, registry } = three();
    expect(moveBlockDown(state, topLocation(state, registry, 2))).toBeNull();
    const next = state.apply(moveBlockDown(state, topLocation(state, registry, 1))!);
    expect(order(next)).toEqual(['one', 'three', 'two']);
  });
});

describe('duplicateBlock', () => {
  it('inserts a copy right after with a fresh sid', () => {
    const { state, registry } = three();
    const loc = topLocation(state, registry, 0);
    const next = state.apply(duplicateBlock(state, loc));
    expect(order(next)).toEqual(['one', 'one', 'two', 'three']);
    const [first, copy] = sids(next);
    // The identity plugin fills the cleared sid, so the copy is a new block, not a
    // second one wearing the original's id.
    expect(copy).not.toBe('');
    expect(copy).not.toBe(first);
  });

  it('clears the identifiers of nested blocks in a container, not just the top', () => {
    const { schema, registry } = createEditorSchema();
    const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
    const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
    const column = (...blocks: PMNode[]) => schema.nodes.columnGroup.create({ sid: 'col', id: 'col' }, [line(), ...blocks]);
    const twoColumn = schema.nodes.twoColumn.create({ sid: 'tc', id: 'tc' }, [
      line(),
      column(para('a', 'sidA')),
      column(para('b', 'sidB')),
    ]);
    const document = schema.nodes.doc.create(null, [twoColumn]);
    const state = EditorState.create({ schema, doc: document });

    const next = state.apply(duplicateBlock(state, locateBlock(state, registry, 0, 'tc')!));

    // No identity plugin here, so the copy carries empty sids the plugin would mint;
    // the point is that every nested block was cleared, not left wearing the original's.
    const copySids: unknown[] = [];
    next.doc.child(1).descendants((node) => {
      if ('sid' in node.attrs) copySids.push(node.attrs.sid);
    });
    expect(copySids.length).toBeGreaterThan(1);
    expect(copySids.every((sid) => sid === '')).toBe(true);

    // The original is untouched.
    const originalSids: unknown[] = [];
    next.doc.child(0).descendants((node) => {
      if ('sid' in node.attrs) originalSids.push(node.attrs.sid);
    });
    expect(originalSids).toContain('sidA');
    expect(originalSids).toContain('sidB');
  });
});

describe('deleteBlock', () => {
  it('removes the block', () => {
    const { state, registry } = three();
    const next = state.apply(deleteBlock(state, topLocation(state, registry, 1))!);
    expect(order(next)).toEqual(['one', 'three']);
  });

  it('refuses to delete the only block, so the document is never emptied', () => {
    const { state, registry } = mount([block('Text', [span('solo')])]);
    expect(deleteBlock(state, topLocation(state, registry, 0))).toBeNull();
  });
});

describe('turnInto', () => {
  it('converts a paragraph to a heading', () => {
    const { state, registry } = three();
    const loc = topLocation(state, registry, 0);
    const heading = TURN_INTO_OPTIONS.find((option) => option.id === 'heading1')!;
    const next = state.apply(turnInto(state, loc, heading)!);
    expect(types(next)[0]).toBe('heading');
    expect(next.doc.child(0).attrs.level).toBe(1);
    expect(order(next)[0]).toBe('one');
  });

  it('is a no-op when the block is already that type', () => {
    const { state, registry } = three();
    const loc = topLocation(state, registry, 0);
    const text = TURN_INTO_OPTIONS.find((option) => option.id === 'text')!;
    expect(turnInto(state, loc, text)).toBeNull();
  });

  it('offers conversion only for text-bearing blocks', () => {
    const { state } = three();
    expect(canTurnInto(state.doc.child(0))).toBe(true);
  });
});

describe('nested blocks inside a column', () => {
  const { schema, registry } = createEditorSchema();
  const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
  const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
  const column = (sid: string, ...blocks: PMNode[]) =>
    schema.nodes.columnGroup.create({ sid, id: sid }, [line(), ...blocks]);

  /** [p1] [twoColumn: [a, b] | [c]] - the left cell holds a sibling run. */
  function state(): EditorState {
    const twoColumn = schema.nodes.twoColumn.create({ sid: 'tc', id: 'tc' }, [
      line(),
      column('colL', para('a', 'sA'), para('b', 'sB')),
      column('colR', para('c', 'sC')),
    ]);
    const doc = schema.nodes.doc.create(null, [para('one', 's1'), twoColumn]);
    return EditorState.create({ schema, doc });
  }

  function locate(current: EditorState, sid: string): BlockLocation {
    // Position 0 is deliberately wrong for nested blocks; the sid path finds them.
    const loc = locateBlock(current, registry, -1, sid);
    if (!loc) throw new Error(`no block with sid ${sid}`);
    return loc;
  }

  function cellTexts(current: EditorState): string[] {
    const out: string[] = [];
    current.doc.child(1).forEach((cell) => {
      if (cell.type.name !== 'columnGroup') return;
      cell.forEach((child) => {
        if (child.type.name === 'paragraph') out.push(child.textContent);
      });
    });
    return out;
  }

  it('locates a cell child with its parent and its own sibling run', () => {
    const loc = locate(state(), 'sA');
    expect(loc.parent.type.name).toBe('columnGroup');
    expect(loc.parentPos).toBeGreaterThanOrEqual(0);
    expect(loc.prev).toBeNull();
    expect(loc.next?.node.textContent).toBe('b');
  });

  it('moves within the cell: down swaps the two children, edges are null', () => {
    const current = state();
    const next = current.apply(moveBlockDown(current, locate(current, 'sA'))!);
    expect(cellTexts(next)).toEqual(['b', 'a', 'c']);
    expect(moveBlockUp(current, locate(current, 'sA'))).toBeNull();
    expect(moveBlockDown(current, locate(current, 'sB'))).toBeNull();
    // The neighbouring cell is not part of this run.
    expect(moveBlockUp(current, locate(current, 'sC'))).toBeNull();
  });

  it('move survives the sid: the swapped child keeps its identity', () => {
    const current = state();
    const next = current.apply(moveBlockDown(current, locate(current, 'sA'))!);
    const relocated = locateBlock(next, registry, -1, 'sA');
    expect(relocated?.node.textContent).toBe('a');
    expect(relocated?.prev?.node.textContent).toBe('b');
  });

  it('deletes a cell child, even the last one in its cell', () => {
    const current = state();
    const one = current.apply(deleteBlock(current, locate(current, 'sC'))!);
    // Without the invariant pipeline (no plugins here) the cell is left empty;
    // in the editor the column-repair invariant reseeds it in the same step -
    // pinned by block-selection-plugin.test.ts. What this pins: the command
    // does not refuse.
    expect(cellTexts(one)).toEqual(['a', 'b']);
  });

  it('duplicates a cell child in place, inside the same cell', () => {
    const current = state();
    const next = current.apply(duplicateBlock(current, locate(current, 'sA')));
    expect(cellTexts(next)).toEqual(['a', 'a', 'b', 'c']);
  });

  it('turns a cell child into a heading in place', () => {
    const current = state();
    const heading = TURN_INTO_OPTIONS.find((option) => option.id === 'heading2')!;
    const next = current.apply(turnInto(current, locate(current, 'sA'), heading)!);
    const relocated = locateBlock(next, registry, -1, 'sA');
    expect(relocated?.node.type.name).toBe('heading');
    expect(relocated?.node.attrs.level).toBe(2);
  });
});
