// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { blockSelectionPlugin } from '../selection/block-selection-plugin';
import { placeBlockRun, replaceSelectedBlocks } from './place-blocks';

const { schema, registry } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid = 'x') => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const heading = (text: string, sid = 'h') =>
  schema.nodes.heading.create({ sid, id: sid, level: 1 }, line(text));
const cell = (sid: string, ...blocks: PMNode[]) =>
  schema.nodes.columnGroup.create({ sid, id: sid }, [line(), ...blocks]);
const twoColumn = (sid: string, left: PMNode, right: PMNode) =>
  schema.nodes.twoColumn.create({ sid, id: sid, splitRatio: 0.5 }, [line(), left, right]);
const docOf = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

const tableCell = (text?: string) => schema.nodes.tableCell.create(null, line(text));
const tableRow = (...cells: PMNode[]) => schema.nodes.tableRow.create(null, [line(), ...cells]);
const table = (...rows: PMNode[]) => schema.nodes.table.create({ columnWidths: [] }, [line(), ...rows]);

/** Position of the first tableCell's own content start, `text.length` past its line's opening. */
function firstCellCaret(doc: PMNode): number {
  let cellPos = -1;
  doc.descendants((node, pos) => {
    if (cellPos >= 0) return false;
    if (node.type.name === 'tableCell') cellPos = pos;
    return true;
  });
  if (cellPos < 0) throw new Error('no tableCell in doc');
  return cellPos + 2;
}

function stateWith(doc: PMNode, caret: number): EditorState {
  const base = EditorState.create({ schema, doc, plugins: [blockSelectionPlugin(registry)] });
  return base.apply(base.tr.setSelection(TextSelection.create(base.doc, caret)));
}

/** A closed run of paragraphs, the shape a block copy produces. */
const run = (...texts: string[]) =>
  new Slice(Fragment.fromArray(texts.map((t) => para(t, ''))), 0, 0);

const texts = (state: { doc: PMNode }): string[] => {
  const out: string[] = [];
  state.doc.forEach((node) => out.push(node.textContent));
  return out;
};

/** Applies a placement and returns the resulting document's top-level texts. */
function placed(doc: PMNode, caret: number, slice: Slice): { texts: string[]; doc: PMNode } {
  const state = stateWith(doc, caret);
  const next = state.apply(placeBlockRun(state, slice));
  return { texts: texts(next), doc: next.doc };
}

const typesOf = (doc: PMNode): string[] => {
  const out: string[] = [];
  doc.forEach((node) => out.push(node.type.name));
  return out;
};

describe('placeBlockRun', () => {
  it('replaces a blank line rather than leaving it behind', () => {
    // doc: para(""), caret inside its line (pos 2).
    const { texts: out } = placed(docOf(para('')), 2, run('pasted'));
    expect(out).toEqual(['pasted']);
  });

  it('replaces any empty prose block, not only an empty paragraph', () => {
    const blanks = [
      schema.nodes.bulletItem.create({ sid: 'b', id: 'b' }, line()),
      schema.nodes.numberedItem.create({ sid: 'n', id: 'n' }, line()),
      schema.nodes.checklistItem.create({ sid: 'c', id: 'c', checked: false }, line()),
      schema.nodes.heading.create({ sid: 'h', id: 'h', level: 1 }, line()),
      schema.nodes.quote.create({ sid: 'q', id: 'q' }, line()),
    ];
    for (const blank of blanks) {
      const { doc } = placed(docOf(blank), 2, run('one', 'two'));
      expect(typesOf(doc), blank.type.name).toEqual(['paragraph', 'paragraph']);
    }
  });

  it('keeps an empty block whose emptiness is its content, placing the run above it', () => {
    const divider = schema.nodes.divider.create({ sid: 'd', id: 'd' }, line());
    const { doc } = placed(docOf(divider), 2, run('one'));
    expect(typesOf(doc)).toEqual(['paragraph', 'divider']);
  });

  it('keeps an empty list item that has blocks nested under it', () => {
    const parent = schema.nodes.bulletItem.create({ sid: 'b', id: 'b' }, [line(), para('child', 'c')]);
    const { doc } = placed(docOf(parent), 2, run('one'));
    expect(typesOf(doc)).toEqual(['paragraph', 'bulletItem']);
    expect(doc.textContent).toContain('child');
  });

  it('inserts above when the caret is at the start of a non-empty block', () => {
    const { texts: out } = placed(docOf(para('here')), 2, run('one', 'two'));
    expect(out).toEqual(['one', 'two', 'here']);
  });

  it('inserts below when the caret is at the end of a block', () => {
    // End of "here": block starts at 0, line content starts at 2, "here" is 4 long.
    const { texts: out } = placed(docOf(para('here')), 6, run('one'));
    expect(out).toEqual(['here', 'one']);
  });

  it('splits the block when the caret is in the middle', () => {
    // Caret between "he" and "re": pos 4.
    const { texts: out } = placed(docOf(para('here')), 4, run('mid'));
    expect(out).toEqual(['he', 'mid', 're']);
  });

  it('drops a selected range within the line and lands the run in the gap', () => {
    const state = stateWith(docOf(para('abcdef')), 3);
    // Select "cd" (pos 4..6) and paste.
    const ranged = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4, 6)));
    const next = ranged.apply(placeBlockRun(ranged, run('X')));
    expect(texts(next)).toEqual(['ab', 'X', 'ef']);
  });

  it('lands the caret at the end of the last pasted block', () => {
    const state = stateWith(docOf(para('here')), 6);
    const next = state.apply(placeBlockRun(state, run('one', 'two')));
    // The caret sits in the second pasted block, at the end of "two".
    const $head = next.doc.resolve(next.selection.head);
    expect($head.parent.textContent).toBe('two');
    expect(next.selection.head).toBe($head.end());
  });

  it('preserves the pasted blocks whole, including a nested two-column row', () => {
    const row = twoColumn('tc', cell('cl', para('a', 'sA')), cell('cr', para('b', 'sB')));
    const slice = new Slice(Fragment.fromArray([row]), 0, 0);
    const { doc } = placed(docOf(para('after')), 2, slice);
    expect(doc.child(0).type.name).toBe('twoColumn');
    expect(doc.child(1).textContent).toBe('after');
  });

  it('places a run whose blocks are not all paragraphs', () => {
    const slice = new Slice(Fragment.fromArray([heading('Title', ''), para('body', '')]), 0, 0);
    const state = stateWith(docOf(para('tail')), 6);
    const next = state.apply(placeBlockRun(state, slice));
    expect(next.doc.child(0).type.name).toBe('paragraph');
    expect(next.doc.child(1).type.name).toBe('heading');
    expect(next.doc.child(2).type.name).toBe('paragraph');
    expect(texts(next)).toEqual(['tail', 'Title', 'body']);
  });

  it('replaces a selection spanning a heading without bleeding its style onto the paste', () => {
    // Select from inside the heading (after "He") into the paragraph (after "bo").
    const state = stateWith(docOf(heading('Head'), para('body')), 4);
    const ranged = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4, 12)));
    const next = ranged.apply(placeBlockRun(ranged, run('pasted')));
    expect(texts(next)).toEqual(['He', 'pasted', 'dy']);
    expect(next.doc.child(0).type.name).toBe('heading'); // the head keeps its type...
    expect(next.doc.child(1).type.name).toBe('paragraph'); // ...but the paste does not inherit it
    expect(next.doc.child(2).type.name).toBe('paragraph'); // the tail is a Text block
  });

  it('drops an endpoint the spanning selection emptied', () => {
    // Select all of the heading's text plus part of the paragraph.
    const state = stateWith(docOf(heading('Head'), para('body')), 2);
    const ranged = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 12)));
    const next = ranged.apply(placeBlockRun(ranged, run('pasted')));
    // The emptied heading is gone rather than left blank above the paste.
    expect(texts(next)).toEqual(['pasted', 'dy']);
    expect(next.doc.child(0).type.name).toBe('paragraph');
  });
});

describe('placeBlockRun folds into a table cell', () => {
  it('lands a single pasted block as the cell line text, not a nested block', () => {
    const doc = docOf(table(tableRow(tableCell())));
    const state = stateWith(doc, firstCellCaret(doc));
    const next = state.apply(placeBlockRun(state, run('pasted')));

    // Still one table, one row, one cell: the cell was never replaced or split.
    expect(next.doc.firstChild!.type.name).toBe('table');
    const cellNode = next.doc.firstChild!.child(1).child(1);
    expect(cellNode.type.name).toBe('tableCell');
    // Just the line: a nested paragraph here is the corruption this guards against.
    expect(cellNode.childCount).toBe(1);
    expect(cellNode.textContent).toBe('pasted');
  });

  it('joins a multi-block run with a soft break instead of nesting each as its own block', () => {
    const doc = docOf(table(tableRow(tableCell())));
    const state = stateWith(doc, firstCellCaret(doc));
    const next = state.apply(placeBlockRun(state, run('one', 'two')));

    const cellNode = next.doc.firstChild!.child(1).child(1);
    expect(cellNode.childCount).toBe(1);
    expect(cellNode.textContent).toBe('one\ntwo');
  });

  it('contributes only its separating break for a block with no text of its own', () => {
    const divider = schema.nodes.divider.create(null, line());
    const slice = new Slice(Fragment.fromArray([para('one', ''), divider, para('two', '')]), 0, 0);
    const doc = docOf(table(tableRow(tableCell())));
    const state = stateWith(doc, firstCellCaret(doc));
    const next = state.apply(placeBlockRun(state, slice));

    const cellNode = next.doc.firstChild!.child(1).child(1);
    expect(cellNode.textContent).toBe('one\n\ntwo');
  });

  it('carries marks on the pasted text into the cell rather than dropping them', () => {
    const strong = schema.marks.strong.create();
    const styled = schema.nodes.paragraph.create(
      null,
      schema.nodes.line.create(null, schema.text('bold', [strong])),
    );
    const slice = new Slice(Fragment.fromArray([styled]), 0, 0);
    const doc = docOf(table(tableRow(tableCell())));
    const state = stateWith(doc, firstCellCaret(doc));
    const next = state.apply(placeBlockRun(state, slice));

    const cellLine = next.doc.firstChild!.child(1).child(1).firstChild!;
    expect(cellLine.textContent).toBe('bold');
    expect(strong.isInSet(cellLine.firstChild!.marks)).toBeTruthy();
  });

  it('never grows or tears the table: row and cell counts survive a fold-in paste', () => {
    const doc = docOf(
      table(
        tableRow(tableCell('a'), tableCell('b')),
        tableRow(tableCell('c'), tableCell('d')),
      ),
    );
    const state = stateWith(doc, firstCellCaret(doc));
    const next = state.apply(placeBlockRun(state, run('one', 'two', 'three')));

    const tableNode = next.doc.firstChild!;
    const rows = [] as PMNode[];
    tableNode.forEach((child) => {
      if (child.type.name === 'tableRow') rows.push(child);
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const cells = [] as PMNode[];
      row.forEach((child) => {
        if (child.type.name === 'tableCell') cells.push(child);
      });
      expect(cells).toHaveLength(2);
    }
  });
});

describe('replaceSelectedBlocks', () => {
  it('replaces the covered blocks with the pasted run', () => {
    const state = stateWith(docOf(para('one', 's1'), para('two', 's2'), para('three', 's3')), 2);
    const next = state.apply(replaceSelectedBlocks(state, run('X', 'Y'), registry, new Set(['s1', 's2']))!);
    expect(texts(next)).toEqual(['X', 'Y', 'three']);
  });

  it('replaces the whole document when every block is selected', () => {
    const state = stateWith(docOf(para('one', 's1'), para('two', 's2')), 2);
    const next = state.apply(replaceSelectedBlocks(state, run('only'), registry, new Set(['s1', 's2']))!);
    expect(texts(next)).toEqual(['only']);
  });

  it('reports nothing when the set covers no range, leaving the caller to place at the caret', () => {
    const state = stateWith(docOf(para('one', 's1')), 4); // caret mid "one"
    expect(replaceSelectedBlocks(state, run('X'), registry, new Set(['ghost']))).toBeNull();
  });
});
