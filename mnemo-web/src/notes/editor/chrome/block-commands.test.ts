// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { createEditorSchema } from '../schema';
import { block, span } from '../mapper/fixtures';
import {
  canTurnInto,
  deleteBlock,
  duplicateBlock,
  locateBlock,
  moveBlockDown,
  moveBlockUp,
  turnInto,
  TURN_INTO_OPTIONS,
} from './block-commands';

type Blocks = Parameters<typeof buildNoteEditState>[0];

function mount(blocks: Blocks): EditorState {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  return built.state;
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

function three(): EditorState {
  return mount([
    block('Text', [span('one')]),
    block('Text', [span('two')]),
    block('Text', [span('three')]),
  ]);
}

describe('move commands', () => {
  it('move up is null at the top and swaps otherwise', () => {
    const state = three();
    expect(moveBlockUp(state, 0)).toBeNull();
    const next = state.apply(moveBlockUp(state, 1)!);
    expect(order(next)).toEqual(['two', 'one', 'three']);
  });

  it('move down is null at the bottom and swaps otherwise', () => {
    const state = three();
    expect(moveBlockDown(state, 2)).toBeNull();
    const next = state.apply(moveBlockDown(state, 1)!);
    expect(order(next)).toEqual(['one', 'three', 'two']);
  });
});

describe('duplicateBlock', () => {
  it('inserts a copy right after with a fresh sid', () => {
    const state = three();
    const loc = locateBlock(state, 0)!;
    const next = state.apply(duplicateBlock(state, loc));
    expect(order(next)).toEqual(['one', 'one', 'two', 'three']);
    const [first, copy] = sids(next);
    // The identity plugin fills the cleared sid, so the copy is a new block, not a
    // second one wearing the original's id.
    expect(copy).not.toBe('');
    expect(copy).not.toBe(first);
  });

  it('clears the identifiers of nested blocks in a container, not just the top', () => {
    const { schema } = createEditorSchema();
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

    const next = state.apply(duplicateBlock(state, { index: 0, pos: 0, node: document.child(0) }));

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
    const state = three();
    const loc = locateBlock(state, 1)!;
    const next = state.apply(deleteBlock(state, loc)!);
    expect(order(next)).toEqual(['one', 'three']);
  });

  it('refuses to delete the only block, so the document is never emptied', () => {
    const state = mount([block('Text', [span('solo')])]);
    const loc = locateBlock(state, 0)!;
    expect(deleteBlock(state, loc)).toBeNull();
  });
});

describe('turnInto', () => {
  it('converts a paragraph to a heading', () => {
    const state = three();
    const loc = locateBlock(state, 0)!;
    const heading = TURN_INTO_OPTIONS.find((option) => option.id === 'heading1')!;
    const next = state.apply(turnInto(state, loc, heading)!);
    expect(types(next)[0]).toBe('heading');
    expect(next.doc.child(0).attrs.level).toBe(1);
    expect(order(next)[0]).toBe('one');
  });

  it('is a no-op when the block is already that type', () => {
    const state = three();
    const loc = locateBlock(state, 0)!;
    const text = TURN_INTO_OPTIONS.find((option) => option.id === 'text')!;
    expect(turnInto(state, loc, text)).toBeNull();
  });

  it('offers conversion only for text-bearing blocks', () => {
    const state = three();
    expect(canTurnInto(state.doc.child(0))).toBe(true);
  });
});
