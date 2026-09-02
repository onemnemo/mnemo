// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { invariantPipeline } from '../pipeline/invariants';
import { lineText } from '../blocks/shared';
import {
  buildCrossBlockDelete,
  crossBlockRangePlugin,
  deleteCrossBlockRange,
} from './range-delete';

const { schema, registry } = createEditorSchema();

// --- builders ---------------------------------------------------------------

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function heading(text: string): PMNode {
  return schema.nodes.heading.create({ level: 1 }, line(text));
}
function code(text: string): PMNode {
  return schema.nodes.codeBlock.create(
    { language: 'csharp' },
    schema.nodes.codeLine.create(null, schema.text(text)),
  );
}
function cell(text: string): PMNode {
  return schema.nodes.tableCell.create(null, line(text));
}
function tableRow(...cells: PMNode[]): PMNode {
  return schema.nodes.tableRow.create(null, [line(), ...cells]);
}
function table(...rows: PMNode[]): PMNode {
  // Sized to the real column count: an unsquared table is repaired by its own
  // invariant, which would rewrite the node under the assertions here.
  return schema.nodes.table.create({ columnWidths: [160, 160] }, [line(), ...rows]);
}
function columnCell(...blocks: PMNode[]): PMNode {
  return schema.nodes.columnGroup.create(null, [line(), ...blocks]);
}
function twoColumn(left: PMNode, right: PMNode): PMNode {
  return schema.nodes.twoColumn.create(null, [line(), left, right]);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

// --- harness ----------------------------------------------------------------

/** Position of `offset` inside the line of the first block, at any depth, reading `text`. */
function posIn(document: PMNode, text: string, offset: number): number {
  let at: number | null = null;
  document.descendants((node, pos) => {
    if (at !== null) return false;
    if (node.isTextblock) return false;
    if (lineText(node) === text) {
      at = pos + 2 + offset;
      return false;
    }
    return true;
  });
  if (at === null) throw new Error(`no block whose line reads ${JSON.stringify(text)}`);
  return at;
}

function stateWith(document: PMNode, from: number, to: number): EditorState {
  return EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, from, to),
    plugins: [invariantPipeline(registry)],
  });
}

/** Runs the owned delete, applying the transaction the way a dispatch would. */
function deleteRange(document: PMNode, from: number, to: number): EditorState {
  const state = stateWith(document, from, to);
  let next = state;
  deleteCrossBlockRange(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

/** Types `text` over the range, through the plugin's own text input handler. */
function typeOver(document: PMNode, from: number, to: number, text: string): EditorState {
  const plugin = crossBlockRangePlugin();
  const view = {
    state: stateWith(document, from, to),
    dispatch(tr: import('prosemirror-state').Transaction) {
      view.state = view.state.apply(tr);
    },
  };
  const handled = plugin.props.handleTextInput!.call(
    plugin,
    view as unknown as EditorView,
    from,
    to,
    text,
    () => view.state.tr,
  );
  expect(Boolean(handled)).toBe(true);
  return view.state;
}

/** Offers a key to the plugin the way prosemirror-view does, without a DOM event. */
function press(state: EditorState, key: string): { handled: boolean; state: EditorState } {
  const plugin = crossBlockRangePlugin();
  let next = state;
  const view = {
    state,
    dispatch(tr: import('prosemirror-state').Transaction) {
      next = state.apply(tr);
    },
  };
  const event = { key, keyCode: key === 'Backspace' ? 8 : 46, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
  const handled = plugin.props.handleKeyDown!.call(
    plugin,
    view as unknown as EditorView,
    event as unknown as KeyboardEvent,
  );
  return { handled: Boolean(handled), state: next };
}

/** Every node name whose parent is not the container it belongs to. */
function strandedParts(document: PMNode): string[] {
  const owner: Record<string, string> = {
    columnGroup: 'twoColumn',
    tableRow: 'table',
    tableCell: 'tableRow',
  };
  const out: string[] = [];
  document.descendants((node, _pos, parent) => {
    const wants = owner[node.type.name];
    if (wants && parent && parent.type.name !== wants) out.push(`${node.type.name} in ${parent.type.name}`);
    return true;
  });
  return out;
}

/** Every table cell's text, in document order. */
function cellTexts(document: PMNode): string[] {
  const out: string[] = [];
  document.descendants((node) => {
    if (node.type.name === 'tableCell') out.push(lineText(node));
    return true;
  });
  return out;
}

function shape(document: PMNode): string {
  const parts: string[] = [];
  document.forEach((node) => parts.push(`${node.type.name}(${JSON.stringify(lineText(node))})`));
  return parts.join(' | ');
}

// --- a range that reaches into a container ----------------------------------

describe('a range that runs from a block into a table', () => {
  const withTable = (head: PMNode): PMNode =>
    doc(head, table(tableRow(cell('a'), cell('b')), tableRow(cell('c'), cell('d'))), para('after'));

  it('trims the cell it reaches and leaves the table whole', () => {
    const document = withTable(para('before'));
    const next = deleteRange(document, posIn(document, 'before', 3), posIn(document, 'a', 1));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(next.doc.childCount).toBe(3);
    expect(lineText(next.doc.child(0))).toBe('bef');
    // The table keeps every cell; the range takes the reached cell's own content
    // and nothing else of the grid.
    expect(cellTexts(next.doc)).toEqual(['', 'b', 'c', 'd']);
    expect(next.selection.from).toBe(posIn(next.doc, 'bef', 3));
    next.doc.check();
  });

  it('does the same from a heading, which the generic replace turned into a row holder', () => {
    const document = withTable(heading('a heading'));
    const next = deleteRange(document, posIn(document, 'a heading', 2), posIn(document, 'a', 1));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(next.doc.child(0).type.name).toBe('heading');
    expect(lineText(next.doc.child(0))).toBe('a ');
    expect(next.doc.child(1).type.name).toBe('table');
    next.doc.check();
  });

  it('does the same from a code block, which the generic replace could not even fit', () => {
    const document = withTable(code('const x = 1;'));
    const next = deleteRange(document, posIn(document, 'const x = 1;', 5), posIn(document, 'a', 1));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(next.doc.child(0).type.name).toBe('codeBlock');
    expect(lineText(next.doc.child(0))).toBe('const');
    expect(cellTexts(next.doc)).toEqual(['', 'b', 'c', 'd']);
    next.doc.check();
  });

  it('answers Backspace and Delete alike', () => {
    for (const key of ['Backspace', 'Delete']) {
      const document = withTable(code('const x = 1;'));
      const from = posIn(document, 'const x = 1;', 5);
      const to = posIn(document, 'a', 1);
      const { handled, state } = press(stateWith(document, from, to), key);

      expect(handled).toBe(true);
      expect(strandedParts(state.doc)).toEqual([]);
      expect(lineText(state.doc.child(0))).toBe('const');
    }
  });

  it('empties the cells the range covers whole, without taking them out of the row', () => {
    const document = withTable(para('before'));
    const next = deleteRange(document, posIn(document, 'a', 0), posIn(document, 'd', 0));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(cellTexts(next.doc)).toEqual(['', '', '', 'd']);
    next.doc.check();
  });

  it('trims the cell it starts in when the range runs out of the table', () => {
    const document = withTable(para('before'));
    const next = deleteRange(document, posIn(document, 'b', 0), posIn(document, 'after', 2));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(next.doc.child(1).type.name).toBe('table');
    // The cells the range covers lose their content and keep their places.
    expect(cellTexts(next.doc)).toEqual(['a', '', '', '']);
    expect(lineText(next.doc.child(2))).toBe('ter');
    expect(next.selection.$from.node(next.selection.$from.depth - 1).type.name).toBe('tableCell');
    next.doc.check();
  });

  it('takes a table that is wholly inside the range as one block', () => {
    const document = withTable(para('before'));
    const next = deleteRange(document, posIn(document, 'before', 3), posIn(document, 'after', 2));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(shape(next.doc)).toBe('paragraph("befter")');
    next.doc.check();
  });
});

describe('a range that runs from a block into a two column', () => {
  const withSplit = (head: PMNode): PMNode =>
    doc(head, twoColumn(columnCell(para('left')), columnCell(para('right'))), para('after'));

  it('trims the cell block it reaches and leaves the split whole', () => {
    const document = withSplit(para('before'));
    const next = deleteRange(document, posIn(document, 'before', 3), posIn(document, 'left', 2));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(next.doc.child(1).type.name).toBe('twoColumn');
    expect(lineText(next.doc.child(0))).toBe('bef');
    expect(lineText(next.doc.child(1).child(1).child(1))).toBe('ft');
    expect(lineText(next.doc.child(1).child(2).child(1))).toBe('right');
    next.doc.check();
  });

  it('does the same from a code block', () => {
    const document = withSplit(code('const x = 1;'));
    const next = deleteRange(document, posIn(document, 'const x = 1;', 5), posIn(document, 'left', 2));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(next.doc.child(1).type.name).toBe('twoColumn');
    expect(lineText(next.doc.child(0))).toBe('const');
    next.doc.check();
  });

  it('joins two blocks inside one cell, which are ordinary siblings', () => {
    const document = doc(
      twoColumn(columnCell(para('one'), para('two')), columnCell(para('right'))),
    );
    const next = deleteRange(document, posIn(document, 'one', 1), posIn(document, 'two', 1));

    const left = next.doc.child(0).child(1);
    expect(left.childCount).toBe(2); // its line, then the one merged block
    expect(lineText(left.child(1))).toBe('owo');
    next.doc.check();
  });

  it('trims the cell block it starts in when the range runs out of the split', () => {
    const document = withSplit(para('before'));
    const next = deleteRange(document, posIn(document, 'right', 2), posIn(document, 'after', 2));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(next.doc.child(1).type.name).toBe('twoColumn');
    expect(lineText(next.doc.child(1).child(2).child(1))).toBe('ri');
    expect(lineText(next.doc.child(2))).toBe('ter');
    next.doc.check();
  });

  it('takes a split that is wholly inside the range as one block', () => {
    const document = withSplit(para('before'));
    const next = deleteRange(document, posIn(document, 'before', 3), posIn(document, 'after', 2));

    expect(strandedParts(next.doc)).toEqual([]);
    expect(shape(next.doc)).toBe('paragraph("befter")');
    next.doc.check();
  });
});

// --- typing over the same range ---------------------------------------------

describe('typing over a range that reaches into a container', () => {
  it('leaves the column cell where it belongs and lands the character in the head', () => {
    const document = doc(
      para('before'),
      twoColumn(columnCell(para('left')), columnCell(para('right'))),
      para('after'),
    );
    const next = typeOver(document, posIn(document, 'before', 3), posIn(document, 'left', 2), 'x');

    expect(strandedParts(next.doc)).toEqual([]);
    expect(lineText(next.doc.child(0))).toBe('befx');
    expect(next.doc.child(1).type.name).toBe('twoColumn');
    next.doc.check();
  });

  it('leaves the table rows where they belong', () => {
    const document = doc(
      heading('a heading'),
      table(tableRow(cell('a'), cell('b')), tableRow(cell('c'), cell('d'))),
    );
    const next = typeOver(document, posIn(document, 'a heading', 2), posIn(document, 'a', 1), 'x');

    expect(strandedParts(next.doc)).toEqual([]);
    expect(lineText(next.doc.child(0))).toBe('a x');
    expect(cellTexts(next.doc)).toEqual(['', 'b', 'c', 'd']);
    next.doc.check();
  });
});

// --- the ranges that were already right --------------------------------------

describe('a range between two ordinary blocks', () => {
  it('leaves one block holding both surviving halves', () => {
    const document = doc(para('abcd'), para('efgh'));
    const next = deleteRange(document, posIn(document, 'abcd', 2), posIn(document, 'efgh', 2));
    expect(shape(next.doc)).toBe('paragraph("abgh")');
  });

  it('keeps the type of the head block when the two differ', () => {
    const document = doc(heading('Title'), para('body'));
    const next = deleteRange(document, posIn(document, 'Title', 2), posIn(document, 'body', 2));
    expect(shape(next.doc)).toBe('heading("Tidy")');
  });

  it('leaves source and prose as two blocks, having no join to make', () => {
    const document = doc(code('const x = 1;'), para('after'));
    const next = deleteRange(document, posIn(document, 'const x = 1;', 5), posIn(document, 'after', 2));

    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).type.name).toBe('codeBlock');
    expect(lineText(next.doc.child(0))).toBe('const');
    expect(lineText(next.doc.child(1))).toBe('ter');
    next.doc.check();
  });
});

describe('the cross block delete declines', () => {
  it('a caret', () => {
    const document = doc(para('abcd'));
    const at = posIn(document, 'abcd', 2);
    expect(buildCrossBlockDelete(stateWith(document, at, at))).toBeNull();
  });

  it('a range inside one block, which needs none of this', () => {
    const document = doc(para('abcd'));
    const state = stateWith(document, posIn(document, 'abcd', 1), posIn(document, 'abcd', 3));
    expect(buildCrossBlockDelete(state)).toBeNull();
    expect(press(state, 'Backspace').handled).toBe(false);
  });

  it('a node selection', () => {
    const document = doc(para('ab'), schema.nodes.divider.create(null, line()));
    const state = EditorState.create({
      schema,
      doc: document,
      selection: NodeSelection.create(document, document.child(0).nodeSize),
    });
    expect(buildCrossBlockDelete(state)).toBeNull();
  });
});
