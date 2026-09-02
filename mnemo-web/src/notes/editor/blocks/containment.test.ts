// @vitest-environment node

/**
 * The rule the schema cannot state: a column cell only inside a two-column, a
 * row only inside a table, a cell only inside a row.
 *
 * Every document here passes `doc.check()` and round-trips over the wire, which
 * is the point: nothing but this invariant notices them. The gestures that
 * produce one are ordinary, a range that starts in a block and ends inside a
 * container, and ProseMirror's generic replace re-parents whatever the container
 * still held rather than dropping it.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { invariantPipeline } from '../pipeline/invariants';

const { schema, registry } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function heading(text: string, ...blocks: PMNode[]): PMNode {
  return schema.nodes.heading.create({ level: 2 }, [line(text), ...blocks]);
}
function column(...blocks: PMNode[]): PMNode {
  return schema.nodes.columnGroup.create(null, [line(), ...blocks]);
}
function twoColumn(left: PMNode, right: PMNode): PMNode {
  return schema.nodes.twoColumn.create(null, [line(), left, right]);
}
function cell(text?: string): PMNode {
  return schema.nodes.tableCell.create(null, line(text));
}
function row(...cells: PMNode[]): PMNode {
  return schema.nodes.tableRow.create(null, [line(), ...cells]);
}
function table(...rows: PMNode[]): PMNode {
  return schema.nodes.table.create({ columnWidths: [] }, [line(), ...rows]);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

function stateWith(document: PMNode): EditorState {
  return EditorState.create({ schema, doc: document, plugins: [invariantPipeline(registry)] });
}

/** The position of the `index`-th node of `name`. */
function posOf(document: PMNode, name: string, index = 0): number {
  let seen = -1;
  let found = -1;
  document.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name !== name) return true;
    seen += 1;
    if (seen === index) found = pos;
    return found < 0;
  });
  if (found < 0) throw new Error(`no ${name} at ${String(index)} in the document`);
  return found;
}

/** The caret position at the start of that node's own line. */
function inLineOf(document: PMNode, name: string, index = 0): number {
  return posOf(document, name, index) + 2;
}

/** Every node whose parent is not the one this rule allows. */
function stranded(document: PMNode): string[] {
  const allowed: Record<string, string> = {
    columnGroup: 'twoColumn',
    tableRow: 'table',
    tableCell: 'tableRow',
  };
  const out: string[] = [];
  document.descendants((node, _pos, parent) => {
    const want = allowed[node.type.name];
    if (want && parent && parent.type.name !== want) {
      out.push(`${node.type.name} in ${parent.type.name}`);
    }
    return true;
  });
  return out;
}

/** The names of a node's block children, its line skipped. */
function shapeOf(node: PMNode): string[] {
  const out: string[] = [];
  node.forEach((child, _offset, index) => {
    if (index === 0) return;
    out.push(child.type.name);
  });
  return out;
}

describe('a range that ends inside a container', () => {
  it('leaves no column cell outside its two column', () => {
    const state = stateWith(
      doc(para('above'), twoColumn(column(para('left')), column(para('right'))), para('below')),
    );
    // Click in the first block, shift-click inside the left cell, type over it.
    const from = inLineOf(state.doc, 'paragraph', 0) + 2;
    const into = inLineOf(state.doc, 'paragraph', 1) + 2;
    const next = state.apply(state.tr.insertText('x', from, into));

    expect(stranded(next.doc)).toEqual([]);
    expect(next.doc.textContent).toContain('right');
  });

  it('leaves no table row outside its table', () => {
    const state = stateWith(
      doc(heading('a heading'), table(row(cell('a'), cell('b')), row(cell('c'), cell('d'))), para('below')),
    );
    const from = inLineOf(state.doc, 'heading') + 2;
    const into = inLineOf(state.doc, 'tableCell') + 1;
    const next = state.apply(state.tr.insertText('x', from, into));

    expect(stranded(next.doc)).toEqual([]);
    // A row's line is scenery and goes with it; a cell's line is the user's
    // text, so what survives comes back as ordinary blocks.
    expect(next.doc.textContent).toContain('d');
  });
});

describe('a structural node already left outside the block that owns it', () => {
  it('is unwrapped into the block that swallowed it', () => {
    const orphan = schema.nodes.paragraph.create(null, [
      line('head'),
      column(para('kept one'), para('kept two')),
    ]);
    const state = stateWith(doc(orphan, para('tail')));
    const next = state.apply(state.tr.insertText('!', inLineOf(state.doc, 'paragraph', 1)));

    expect(stranded(next.doc)).toEqual([]);
    expect(shapeOf(next.doc.child(0))).toEqual(['paragraph', 'paragraph']);
    expect(next.doc.child(0).textContent).toContain('kept one');
    expect(next.doc.child(0).textContent).toContain('kept two');
  });

  it('brings a row and its cells out together, keeping the cell text', () => {
    const orphan = heading('head', row(cell('a'), cell('b')));
    const state = stateWith(doc(orphan, para('tail')));
    const next = state.apply(state.tr.insertText('!', inLineOf(state.doc, 'tableCell') + 1));

    expect(stranded(next.doc)).toEqual([]);
    expect(shapeOf(next.doc.child(0))).toEqual(['paragraph', 'paragraph']);
    expect(next.doc.child(0).textContent).toContain('a!');
    expect(next.doc.child(0).textContent).toContain('b');
  });

  it('keeps the document a legal shape when the strand was all it held', () => {
    // The doc's content is `block+`, so removing its only child is not an option.
    const state = stateWith(doc(column(para('only'))));
    const inner = posOf(state.doc, 'paragraph');
    const next = state.apply(state.tr.delete(inner, inner + state.doc.nodeAt(inner)!.nodeSize));

    expect(stranded(next.doc)).toEqual([]);
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).type.name).toBe('paragraph');
  });

  it('hands an emptied cell to the never-empty repair rather than leaving a bare lane', () => {
    // The lane's only child is a stranded row with nothing in it, so unwrapping
    // takes the lane down to its line, which the repair after this refills.
    const state = stateWith(doc(para('above'), twoColumn(column(row(cell())), column(para('R')))));
    const next = state.apply(state.tr.insertText('!', inLineOf(state.doc, 'tableCell')));

    expect(stranded(next.doc)).toEqual([]);
    const left = next.doc.child(1).child(1);
    expect(left.type.name).toBe('columnGroup');
    expect(shapeOf(left)).toEqual(['paragraph']);
  });

  it('leaves a legal container alone', () => {
    const state = stateWith(doc(para('above'), twoColumn(column(para('L')), column(para('R')))));
    const next = state.apply(state.tr.insertText('!', inLineOf(state.doc, 'paragraph', 1) + 1));

    expect(stranded(next.doc)).toEqual([]);
    expect(next.doc.child(1).type.name).toBe('twoColumn');
    expect(shapeOf(next.doc.child(1))).toEqual(['columnGroup', 'columnGroup']);
    expect(next.doc.child(1).textContent).toContain('L!');
  });

  it('settles in one pass rather than trading repairs with the never-empty rule', () => {
    const orphan = schema.nodes.paragraph.create(null, [line('head'), column()]);
    const state = stateWith(doc(orphan, para('tail')));
    const once = state.apply(state.tr.insertText('!', inLineOf(state.doc, 'columnGroup')));
    const twice = once.apply(once.tr.insertText('?', 2));

    expect(stranded(twice.doc)).toEqual([]);
    // The second edit found nothing left to repair, so the block is the shape
    // the first pass left, plus the character it typed.
    expect(shapeOf(twice.doc.child(0))).toEqual(shapeOf(once.doc.child(0)));
  });

  it('leaves nesting it has no rule about alone', () => {
    // A list item holding further items is a shape the product makes on purpose,
    // and this rule is about three node types, not about depth.
    const item = (text: string, ...children: PMNode[]) =>
      schema.nodes.bulletItem.create(null, [line(text), ...children]);
    const nest = item('outer', item('inner', item('deepest')));
    const orphan = schema.nodes.paragraph.create(null, [line('head'), column(para('kept'))]);
    const state = stateWith(doc(orphan, nest));
    const next = state.apply(state.tr.insertText('!', inLineOf(state.doc, 'paragraph', 1)));

    expect(stranded(next.doc)).toEqual([]);
    const outer = next.doc.child(1);
    expect(outer.type.name).toBe('bulletItem');
    expect(shapeOf(outer)).toEqual(['bulletItem']);
    expect(shapeOf(outer.child(1))).toEqual(['bulletItem']);
    expect(outer.textContent).toBe('outerinnerdeepest');
  });

  it('does not fire for a keystroke that never went near one', () => {
    const state = stateWith(doc(para('above'), twoColumn(column(para('L')), column(para('R')))));
    const typed = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)).insertText('x', 2),
    );
    expect(typed.doc.child(0).textContent).toBe('xabove');
    expect(stranded(typed.doc)).toEqual([]);
  });
});
