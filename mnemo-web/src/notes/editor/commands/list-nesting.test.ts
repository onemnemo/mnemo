// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import {
  indentListItem,
  indentTransaction,
  isNested,
  listNestingKeyBindings,
  outdentListItem,
  outdentTransaction,
} from './list-nesting';

const { schema } = createEditorSchema();

// --- doc builders -----------------------------------------------------------

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function bullet(text: string, children: PMNode[] = [], attrs?: Record<string, unknown>): PMNode {
  return schema.nodes.bulletItem.create(attrs ?? null, [line(text), ...children]);
}
function numbered(text: string, children: PMNode[] = []): PMNode {
  return schema.nodes.numberedItem.create(null, [line(text), ...children]);
}
function check(text: string, children: PMNode[] = []): PMNode {
  return schema.nodes.checklistItem.create({ checked: true }, [line(text), ...children]);
}
function para(text: string, children: PMNode[] = []): PMNode {
  return schema.nodes.paragraph.create(null, [line(text), ...children]);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

/** The document as an indented outline, one block per line, so a structure reads at a glance. */
function outline(node: PMNode, depth = 0): string[] {
  const out: string[] = [];
  node.forEach((child) => {
    if (child.isTextblock) return;
    const text = child.firstChild?.textContent ?? '';
    out.push(`${'  '.repeat(depth)}${child.type.name}:${text}`);
    out.push(...outline(child, depth + 1));
  });
  return out;
}

/** Position just before the block reached by `path`, child indexes among blocks only. */
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

/** Absolute position `offset` into the line of the block at `path`. */
function caretAt(document: PMNode, path: readonly number[], offset: number): number {
  return blockPos(document, path) + 2 + offset;
}

function run(document: PMNode, command: Command, from: number, to = from): { state: EditorState; handled: boolean } {
  const state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, from, to),
  });
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { state: next, handled };
}

function stateOf(document: PMNode): EditorState {
  return EditorState.create({ schema, doc: document });
}

// --- indent -----------------------------------------------------------------

describe('indentTransaction', () => {
  it('nests an item under the item above it, sub-list and all', () => {
    const d = doc(bullet('a'), bullet('b', [bullet('c')]), bullet('d'));
    const tr = indentTransaction(stateOf(d), blockPos(d, [1]), d.child(1));
    expect(tr).not.toBeNull();
    expect(outline(tr!.doc)).toEqual([
      'bulletItem:a',
      '  bulletItem:b',
      '    bulletItem:c',
      'bulletItem:d',
    ]);
  });

  it('appends after the children the item above already has', () => {
    const d = doc(bullet('a', [bullet('a1')]), bullet('b'));
    const tr = indentTransaction(stateOf(d), blockPos(d, [1]), d.child(1))!;
    expect(outline(tr.doc)).toEqual(['bulletItem:a', '  bulletItem:a1', '  bulletItem:b']);
  });

  it('carries identity across unchanged', () => {
    const d = doc(bullet('a'), bullet('b', [], { id: 'g2', sid: 'bb22b' }));
    const tr = indentTransaction(stateOf(d), blockPos(d, [1]), d.child(1))!;
    const moved = tr.doc.child(0).child(1);
    expect(moved.attrs.id).toBe('g2');
    expect(moved.attrs.sid).toBe('bb22b');
  });

  it('nests any list kind under any other', () => {
    const d = doc(check('todo'), numbered('n'), bullet('b'));
    const s = stateOf(d);
    expect(outline(indentTransaction(s, blockPos(d, [1]), d.child(1))!.doc)).toEqual([
      'checklistItem:todo',
      '  numberedItem:n',
      'bulletItem:b',
    ]);
  });

  it('declines a first item, a paragraph, and an item below a paragraph', () => {
    const first = doc(bullet('a'), bullet('b'));
    expect(indentTransaction(stateOf(first), blockPos(first, [0]), first.child(0))).toBeNull();
    const afterPara = doc(para('p'), bullet('b'));
    expect(indentTransaction(stateOf(afterPara), blockPos(afterPara, [1]), afterPara.child(1))).toBeNull();
    const paragraph = doc(bullet('a'), para('p'));
    expect(indentTransaction(stateOf(paragraph), blockPos(paragraph, [1]), paragraph.child(1))).toBeNull();
  });
});

describe('indentListItem (Tab)', () => {
  it('keeps the caret at the same offset in the moved item', () => {
    const d = doc(bullet('a'), bullet('milk'));
    const { state, handled } = run(d, indentListItem, caretAt(d, [1], 2));
    expect(handled).toBe(true);
    expect(outline(state.doc)).toEqual(['bulletItem:a', '  bulletItem:milk']);
    expect(state.selection.from).toBe(caretAt(state.doc, [0, 0], 2));
  });

  it('keeps a selection inside the item', () => {
    const d = doc(bullet('a'), bullet('milk'));
    const { state } = run(d, indentListItem, caretAt(d, [1], 1), caretAt(d, [1], 3));
    expect(state.selection.from).toBe(caretAt(state.doc, [0, 0], 1));
    expect(state.selection.to).toBe(caretAt(state.doc, [0, 0], 3));
  });

  it('claims the key in a first item without changing the document', () => {
    const d = doc(bullet('a'), bullet('b'));
    const { state, handled } = run(d, indentListItem, caretAt(d, [0], 1));
    expect(handled).toBe(true);
    expect(state.doc.eq(d)).toBe(true);
  });

  it('declines outside a list item, so Tab still moves focus there', () => {
    const d = doc(bullet('a'), para('p'));
    const { handled } = run(d, indentListItem, caretAt(d, [1], 0));
    expect(handled).toBe(false);
  });
});

// --- outdent ----------------------------------------------------------------

describe('outdentTransaction', () => {
  it('lifts a child out after its parent', () => {
    const d = doc(bullet('a', [bullet('b')]), bullet('c'));
    const tr = outdentTransaction(stateOf(d), blockPos(d, [0, 0]), d.child(0).child(1))!;
    expect(outline(tr.doc)).toEqual(['bulletItem:a', 'bulletItem:b', 'bulletItem:c']);
  });

  it('hands the lifted item the siblings that followed it', () => {
    const d = doc(bullet('a', [bullet('b'), bullet('c'), bullet('d')]));
    const tr = outdentTransaction(stateOf(d), blockPos(d, [0, 1]), d.child(0).child(2))!;
    expect(outline(tr.doc)).toEqual([
      'bulletItem:a',
      '  bulletItem:b',
      'bulletItem:c',
      '  bulletItem:d',
    ]);
  });

  it('keeps the lifted item\'s own children ahead of the siblings it takes', () => {
    const d = doc(bullet('a', [bullet('b', [bullet('b1')]), bullet('c')]));
    const tr = outdentTransaction(stateOf(d), blockPos(d, [0, 0]), d.child(0).child(1))!;
    expect(outline(tr.doc)).toEqual([
      'bulletItem:a',
      'bulletItem:b',
      '  bulletItem:b1',
      '  bulletItem:c',
    ]);
  });

  it('lifts a paragraph that sits under an item', () => {
    const d = doc(bullet('a', [para('p')]));
    const tr = outdentTransaction(stateOf(d), blockPos(d, [0, 0]), d.child(0).child(1))!;
    expect(outline(tr.doc)).toEqual(['bulletItem:a', 'paragraph:p']);
  });

  it('declines at the top level', () => {
    const d = doc(bullet('a'), bullet('b'));
    expect(outdentTransaction(stateOf(d), blockPos(d, [1]), d.child(1))).toBeNull();
  });
});

describe('outdentListItem (Shift+Tab)', () => {
  it('keeps the caret at the same offset in the lifted item', () => {
    const d = doc(bullet('a', [bullet('milk')]));
    const { state, handled } = run(d, outdentListItem, caretAt(d, [0, 0], 3));
    expect(handled).toBe(true);
    expect(outline(state.doc)).toEqual(['bulletItem:a', 'bulletItem:milk']);
    expect(state.selection.from).toBe(caretAt(state.doc, [1], 3));
  });

  it('claims the key in a top-level item without changing the document', () => {
    const d = doc(bullet('a'), bullet('b'));
    const { state, handled } = run(d, outdentListItem, caretAt(d, [1], 0));
    expect(handled).toBe(true);
    expect(state.doc.eq(d)).toBe(true);
  });

  it('lifts a nested paragraph, and declines a top-level one', () => {
    const nested = doc(bullet('a', [para('p')]));
    expect(run(nested, outdentListItem, caretAt(nested, [0, 0], 0)).handled).toBe(true);
    const flat = doc(bullet('a'), para('p'));
    expect(run(flat, outdentListItem, caretAt(flat, [1], 0)).handled).toBe(false);
  });
});

describe('Tab round trip', () => {
  it('indent then outdent restores the document', () => {
    const d = doc(bullet('a', [bullet('a1')]), bullet('b', [bullet('b1')]), bullet('c'));
    const s1 = run(d, indentListItem, caretAt(d, [1], 1)).state;
    expect(outline(s1.doc)).toEqual([
      'bulletItem:a',
      '  bulletItem:a1',
      '  bulletItem:b',
      '    bulletItem:b1',
      'bulletItem:c',
    ]);
    const s2 = run(s1.doc, outdentListItem, s1.selection.from).state;
    expect(s2.doc.eq(d)).toBe(true);
  });
});

describe('bindings', () => {
  it('binds Tab to indent and Shift+Tab to outdent', () => {
    const d = doc(bullet('a'), bullet('b'));
    const bindings = listNestingKeyBindings();
    const nested = run(d, bindings.Tab, caretAt(d, [1], 0)).state;
    expect(outline(nested.doc)).toEqual(['bulletItem:a', '  bulletItem:b']);
    const lifted = run(nested.doc, bindings['Shift-Tab'], nested.selection.from).state;
    expect(lifted.doc.eq(d)).toBe(true);
  });

  it('answers Tab in prose as well, so focus never leaves the editor', () => {
    // Unbound, the browser walks to the next tab stop inside the note (a to-do
    // box, a card link) and the keystrokes after it go there instead.
    const d = doc(para('plain'));
    const { state, handled } = run(d, listNestingKeyBindings().Tab, caretAt(d, [0], 0));
    expect(handled).toBe(true);
    expect(state.doc.eq(d)).toBe(true);
  });

  it('isNested answers for list item parents only', () => {
    const d = doc(bullet('a', [para('p')]), para('q'));
    expect(isNested(stateOf(d), blockPos(d, [0, 0]))).toBe(true);
    expect(isNested(stateOf(d), blockPos(d, [1]))).toBe(false);
  });
});
