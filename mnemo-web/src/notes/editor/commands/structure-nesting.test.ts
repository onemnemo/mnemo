// @vitest-environment node
/**
 * The structural keys on a nested list: what Enter, Backspace and Delete do when
 * the caret's block holds a sub-list or sits inside one.
 */
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { backspaceStructural, deleteForwardStructural, splitBlock } from './structure';

const { schema } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function bullet(text: string, children: PMNode[] = [], attrs?: Record<string, unknown>): PMNode {
  return schema.nodes.bulletItem.create(attrs ?? null, [line(text), ...children]);
}
function check(text: string, children: PMNode[] = []): PMNode {
  return schema.nodes.checklistItem.create({ checked: false }, [line(text), ...children]);
}
function para(text: string, children: PMNode[] = []): PMNode {
  return schema.nodes.paragraph.create(null, [line(text), ...children]);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

function outline(node: PMNode, depth = 0): string[] {
  const out: string[] = [];
  node.forEach((child) => {
    if (child.isTextblock) return;
    out.push(`${'  '.repeat(depth)}${child.type.name}:${child.firstChild?.textContent ?? ''}`);
    out.push(...outline(child, depth + 1));
  });
  return out;
}

function blockPos(document: PMNode, path: readonly number[]): number {
  let parent = document;
  let contentStart = 0;
  let pos = 0;
  for (const index of path) {
    let seen = 0;
    let found = -1;
    let offset = contentStart;
    let node: PMNode | null = null;
    parent.forEach((child) => {
      const childPos = offset;
      offset += child.nodeSize;
      if (child.isTextblock || found >= 0) return;
      if (seen === index) {
        found = childPos;
        node = child;
      }
      seen += 1;
    });
    if (found < 0 || !node) throw new Error(`no block at ${path.join('/')}`);
    pos = found;
    parent = node;
    contentStart = pos + 1;
  }
  return pos;
}

function caretAt(document: PMNode, path: readonly number[], offset: number): number {
  return blockPos(document, path) + 2 + offset;
}

function run(document: PMNode, command: Command, from: number): { state: EditorState; handled: boolean } {
  const state = EditorState.create({ schema, doc: document, selection: TextSelection.create(document, from) });
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { state: next, handled };
}

// --- Enter ------------------------------------------------------------------

describe('Enter on a nested list', () => {
  it('lifts an empty nested item out one level, keeping its type', () => {
    const d = doc(bullet('a', [bullet('b'), bullet('')]));
    const { state } = run(d, splitBlock, caretAt(d, [0, 1], 0));
    expect(outline(state.doc)).toEqual(['bulletItem:a', '  bulletItem:b', 'bulletItem:']);
    expect(state.selection.from).toBe(caretAt(state.doc, [1], 0));
  });

  it('turns an empty top-level item into Text and leaves its sub-list under it', () => {
    const d = doc(bullet('', [bullet('b')]));
    const { state } = run(d, splitBlock, caretAt(d, [0], 0));
    expect(outline(state.doc)).toEqual(['paragraph:', '  bulletItem:b']);
  });

  it('at the end of a parent line puts the new item at the head of its sub-list', () => {
    const d = doc(bullet('a', [bullet('b')]));
    const { state } = run(d, splitBlock, caretAt(d, [0], 1));
    expect(outline(state.doc)).toEqual(['bulletItem:a', '  bulletItem:', '  bulletItem:b']);
    expect(state.selection.from).toBe(caretAt(state.doc, [0, 0], 0));
  });

  it('mid-line in a parent moves the tail to the head of its sub-list', () => {
    const d = doc(check('todo', [bullet('b')]));
    const { state } = run(d, splitBlock, caretAt(d, [0], 2));
    expect(outline(state.doc)).toEqual(['checklistItem:to', '  checklistItem:do', '  bulletItem:b']);
  });

  it('in a nested item without children splits into a same-type sibling beside it', () => {
    const d = doc(bullet('a', [bullet('milk')]));
    const { state } = run(d, splitBlock, caretAt(d, [0, 0], 2));
    expect(outline(state.doc)).toEqual(['bulletItem:a', '  bulletItem:mi', '  bulletItem:lk']);
  });
});

// --- Backspace --------------------------------------------------------------

describe('Backspace at the start of a nested block', () => {
  it('de-formats a nested item to Text in place, keeping it nested', () => {
    const d = doc(bullet('a', [bullet('b', [bullet('c')])]));
    const { state } = run(d, backspaceStructural, caretAt(d, [0, 0], 0));
    expect(outline(state.doc)).toEqual(['bulletItem:a', '  paragraph:b', '    bulletItem:c']);
  });

  it('merges a first-child paragraph into its parent line and promotes its children to the head', () => {
    const d = doc(bullet('a', [para('b', [bullet('b1')]), bullet('c')]));
    const { state } = run(d, backspaceStructural, caretAt(d, [0, 0], 0));
    expect(outline(state.doc)).toEqual(['bulletItem:ab', '  bulletItem:b1', '  bulletItem:c']);
    expect(state.selection.from).toBe(caretAt(state.doc, [0], 1));
  });

  it('merges a later paragraph into the last line of the sibling above and hands it the children', () => {
    const d = doc(bullet('a', [bullet('b', [bullet('b1')]), para('c', [bullet('c1')])]));
    const { state } = run(d, backspaceStructural, caretAt(d, [0, 1], 0));
    // "b1" is the line directly above "c", so that is where the text goes, and
    // "c1" stays indented under the line it now belongs to.
    expect(outline(state.doc)).toEqual([
      'bulletItem:a',
      '  bulletItem:b',
      '    bulletItem:b1c',
      '      bulletItem:c1',
    ]);
  });

  it('deletes an empty first-child paragraph and puts the caret at the end of the parent line', () => {
    const d = doc(bullet('abc', [para(''), bullet('c')]));
    const { state } = run(d, backspaceStructural, caretAt(d, [0, 0], 0));
    expect(outline(state.doc)).toEqual(['bulletItem:abc', '  bulletItem:c']);
    expect(state.selection.from).toBe(caretAt(state.doc, [0], 3));
  });

  it('dissolves an empty top-level paragraph into its children', () => {
    const d = doc(para('above'), para('', [bullet('x'), bullet('y')]));
    const { state } = run(d, backspaceStructural, caretAt(d, [1], 0));
    expect(outline(state.doc)).toEqual(['paragraph:above', 'bulletItem:x', 'bulletItem:y']);
    expect(state.selection.from).toBe(caretAt(state.doc, [0], 5));
  });

  it('dissolves an empty first paragraph into its children when nothing precedes it', () => {
    const d = doc(para('', [bullet('x')]));
    const { state } = run(d, backspaceStructural, caretAt(d, [0], 0));
    expect(outline(state.doc)).toEqual(['bulletItem:x']);
  });

  it('merges a top-level paragraph up and gives the block above its children', () => {
    const d = doc(bullet('a'), para('b', [bullet('b1')]));
    const { state } = run(d, backspaceStructural, caretAt(d, [1], 0));
    expect(outline(state.doc)).toEqual(['bulletItem:ab', '  bulletItem:b1']);
  });
});

// --- Delete -----------------------------------------------------------------

describe('Delete at the end of a line in a nested list', () => {
  it('on a parent absorbs the first child paragraph and promotes its children', () => {
    const d = doc(bullet('a', [para('b', [bullet('b1')]), bullet('c')]));
    const { state } = run(d, deleteForwardStructural, caretAt(d, [0], 1));
    expect(outline(state.doc)).toEqual(['bulletItem:ab', '  bulletItem:b1', '  bulletItem:c']);
    expect(state.selection.from).toBe(caretAt(state.doc, [0], 1));
  });

  it('on the last nested item absorbs the paragraph that follows the parent', () => {
    const d = doc(bullet('a', [bullet('b')]), para('c'));
    const { state } = run(d, deleteForwardStructural, caretAt(d, [0, 0], 1));
    expect(outline(state.doc)).toEqual(['bulletItem:a', '  bulletItem:bc']);
  });

  it('swallows the key when the first child is not Text', () => {
    const d = doc(bullet('a', [bullet('b')]));
    const { state, handled } = run(d, deleteForwardStructural, caretAt(d, [0], 1));
    expect(handled).toBe(true);
    expect(state.doc.eq(d)).toBe(true);
  });
});

// --- the line above a nested list --------------------------------------------

describe('Backspace below a nested list', () => {
  it('merges into the last item of the list above, the line the eye sees, and moves the caret there', () => {
    const d = doc(bullet('a', [bullet('b', [bullet('c')])]), para('x'));
    const { state } = run(d, backspaceStructural, caretAt(d, [1], 0));
    expect(outline(state.doc)).toEqual(['bulletItem:a', '  bulletItem:b', '    bulletItem:cx']);
    expect(state.selection.from).toBe(caretAt(state.doc, [0, 0, 0], 1));
  });

  it('carries the merged block\'s children into that item', () => {
    const d = doc(bullet('a', [bullet('b')]), para('x', [bullet('x1')]));
    const { state } = run(d, backspaceStructural, caretAt(d, [1], 0));
    expect(outline(state.doc)).toEqual(['bulletItem:a', '  bulletItem:bx', '    bulletItem:x1']);
  });

  it('deletes an empty paragraph and lands the caret on the last item above', () => {
    const d = doc(bullet('a', [bullet('bb')]), para(''));
    const { state } = run(d, backspaceStructural, caretAt(d, [1], 0));
    expect(outline(state.doc)).toEqual(['bulletItem:a', '  bulletItem:bb']);
    expect(state.selection.from).toBe(caretAt(state.doc, [0, 0], 2));
  });

  it('never enters a two-column above, whose cells are their own merge world', () => {
    const cell = (...blocks: PMNode[]) => schema.nodes.columnGroup.create(null, [line(), ...blocks]);
    const row = schema.nodes.twoColumn.create(null, [line(), cell(para('l')), cell(bullet('r', [bullet('r1')]))]);
    const d = doc(row, para('x'));
    const { state, handled } = run(d, backspaceStructural, caretAt(d, [1], 0));
    expect(handled).toBe(true);
    expect(state.doc.eq(d)).toBe(true);
  });
});
