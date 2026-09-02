// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { invariantPipeline } from '../pipeline/invariants';
import { backspaceStructural } from './structure';
import { blockChildrenOf, lineOf, lineText } from '../blocks/shared';

const { schema, registry } = createEditorSchema();

// --- builders ---------------------------------------------------------------

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text: string, sid = ''): PMNode {
  return schema.nodes.paragraph.create({ sid }, line(text));
}
function heading(text: string, level = 1): PMNode {
  return schema.nodes.heading.create({ level }, schema.nodes.line.create(null, schema.text(text)));
}
function cell(...blocks: PMNode[]): PMNode {
  return schema.nodes.columnGroup.create(null, [line(), ...blocks]);
}
function divider(): PMNode {
  return schema.nodes.divider.create(null, line());
}
function tableCell(text: string): PMNode {
  return schema.nodes.tableCell.create(null, line(text));
}
function tableRow(...cells: PMNode[]): PMNode {
  return schema.nodes.tableRow.create(null, [line(), ...cells]);
}
function table(...rows: PMNode[]): PMNode {
  return schema.nodes.table.create({ columnWidths: [] }, [line(), ...rows]);
}
function twoColumn(left: PMNode, right: PMNode, sid = 'tc'): PMNode {
  return schema.nodes.twoColumn.create({ sid }, [line(), left, right]);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

function stateWith(document: PMNode): EditorState {
  return EditorState.create({ schema, doc: document, plugins: [invariantPipeline(registry)] });
}

/** Caret at offset 0 of the first block whose line text equals `text`. */
function caretAtStartOf(document: PMNode, text: string): number {
  let pos: number | null = null;
  const containers = new Set(['twoColumn', 'columnGroup']);
  document.descendants((node, p) => {
    if (pos !== null) return false;
    if (!containers.has(node.type.name) && node.type.isBlock && lineOf(node) && lineText(node) === text) {
      // p is before the block, +1 into the block, +1 into its line: offset 0.
      pos = p + 2;
      return false;
    }
    return true;
  });
  if (pos === null) throw new Error(`no block with line text ${JSON.stringify(text)}`);
  return pos;
}

/** Runs the structural Backspace with the caret at the start of `atText`. */
function backspaceAtStartOf(document: PMNode, atText: string): { handled: boolean; state: EditorState } {
  const base = stateWith(document);
  const placed = base.apply(base.tr.setSelection(TextSelection.create(base.doc, caretAtStartOf(base.doc, atText))));
  let out = placed;
  const handled = backspaceStructural(placed, (tr) => {
    out = placed.apply(tr);
  });
  return { handled, state: out };
}

/** The single two-column block in the document, or null. */
function twoColumnOf(document: PMNode): PMNode | null {
  let found: PMNode | null = null;
  document.forEach((child) => {
    if (child.type.name === 'twoColumn') found = child;
  });
  return found;
}

function cellTexts(tc: PMNode, leftCell: boolean): string[] {
  return blockChildrenOf(tc.child(leftCell ? 1 : 2)).map((b) => lineText(b));
}

// --- dissolve ---------------------------------------------------------------

describe('two-column dissolve on Backspace at a cell start', () => {
  it('promotes the left cell when the sole right block backspaces away', () => {
    const document = doc(twoColumn(cell(para('L0'), para('L1')), cell(para('R0'))));
    const { handled, state } = backspaceAtStartOf(document, 'R0');

    expect(handled).toBe(true);
    // The split is gone; the left cell's blocks are top level, R0 merged into L1.
    expect(twoColumnOf(state.doc)).toBeNull();
    expect(state.doc.childCount).toBe(2);
    expect(lineText(state.doc.child(0))).toBe('L0');
    expect(lineText(state.doc.child(1))).toBe('L1R0');
    state.doc.check();
  });

  it('promotes the right cell when the sole left block backspaces into the block above', () => {
    const document = doc(para('top'), twoColumn(cell(para('L0')), cell(para('R0'), para('R1'))));
    const { state } = backspaceAtStartOf(document, 'L0');

    expect(twoColumnOf(state.doc)).toBeNull();
    expect(state.doc.childCount).toBe(3);
    expect(lineText(state.doc.child(0))).toBe('topL0');
    expect(lineText(state.doc.child(1))).toBe('R0');
    expect(lineText(state.doc.child(2))).toBe('R1');
    state.doc.check();
  });

  it('lands the caret at the merge seam, not at the joined block start', () => {
    const document = doc(twoColumn(cell(para('L0'), para('L1')), cell(para('R0'))));
    const { state } = backspaceAtStartOf(document, 'R0');
    // 'L1R0' with the caret between 'L1' and 'R0'.
    expect(state.selection.$from.parentOffset).toBe(2);
    expect(state.selection.$from.parent.textContent).toBe('L1R0');
  });

  it('does nothing when the split is the first block and its left cell empties', () => {
    // The left cell's sole block has nothing before it in the whole document.
    const document = doc(twoColumn(cell(para('L0')), cell(para('R0'))));
    const before = stateWith(document);
    const { handled, state } = backspaceAtStartOf(document, 'L0');

    expect(handled).toBe(true); // swallowed, so no character delete happens either
    expect(state.doc.eq(before.doc)).toBe(true);
  });

  it('carries an empty caret block away and still dissolves', () => {
    const document = doc(twoColumn(cell(para('L0'), para('L1')), cell(para(''))));
    const { state } = backspaceAtStartOf(document, '');
    expect(twoColumnOf(state.doc)).toBeNull();
    expect(state.doc.childCount).toBe(2);
    expect(lineText(state.doc.child(1))).toBe('L1');
    state.doc.check();
  });

  it('leaves no empty column for the neverEmpty invariant to refill', () => {
    const document = doc(twoColumn(cell(para('L0')), cell(para('R0'), para('R1'))));
    const { state } = backspaceAtStartOf(document, 'R0');
    // A right cell of two blocks: R0 removed, R1 remains, no dissolve, no re-seed.
    const tc = twoColumnOf(state.doc);
    expect(tc).not.toBeNull();
    expect(cellTexts(tc!, false)).toEqual(['R1']);
  });
});

// --- keep the split ---------------------------------------------------------

describe('two-column merge that keeps the split', () => {
  it('merges a first right block into the last left block without dissolving', () => {
    const document = doc(twoColumn(cell(para('L0')), cell(para('R0'), para('R1'))));
    const { state } = backspaceAtStartOf(document, 'R0');

    const tc = twoColumnOf(state.doc);
    expect(tc).not.toBeNull();
    expect(cellTexts(tc!, true)).toEqual(['L0R0']);
    expect(cellTexts(tc!, false)).toEqual(['R1']);
    state.doc.check();
  });

  it('merges a first left block into the block above without dissolving', () => {
    const document = doc(para('top'), twoColumn(cell(para('L0'), para('L1')), cell(para('R0'))));
    const { state } = backspaceAtStartOf(document, 'L0');

    expect(lineText(state.doc.child(0))).toBe('topL0');
    const tc = twoColumnOf(state.doc);
    expect(tc).not.toBeNull();
    expect(cellTexts(tc!, true)).toEqual(['L1']);
    expect(cellTexts(tc!, false)).toEqual(['R0']);
    state.doc.check();
  });

  it('preserves identity: the split and the merge target keep their sids', () => {
    const document = doc(
      para('top', 'topSid'),
      twoColumn(cell(para('L0', 'l0'), para('L1', 'l1')), cell(para('R0', 'r0')), 'tcSid'),
    );
    const { state } = backspaceAtStartOf(document, 'L0');

    expect(state.doc.child(0).attrs.sid).toBe('topSid');
    const tc = twoColumnOf(state.doc);
    expect(tc!.attrs.sid).toBe('tcSid');
    // The surviving left block keeps its own sid.
    expect(tc!.child(1).child(1).attrs.sid).toBe('l1');
  });
});

// --- the cases this must not disturb ---------------------------------------

describe('two-column Backspace leaves ordinary cases alone', () => {
  it('merges within a cell when the caret block is not the first', () => {
    const document = doc(twoColumn(cell(para('L0'), para('L1')), cell(para('R0'))));
    const { state } = backspaceAtStartOf(document, 'L1');

    const tc = twoColumnOf(state.doc);
    expect(tc).not.toBeNull(); // an intra-cell merge never dissolves
    expect(cellTexts(tc!, true)).toEqual(['L0L1']);
    expect(cellTexts(tc!, false)).toEqual(['R0']);
  });

  it('de-formats a formatted first cell block instead of dissolving', () => {
    const document = doc(twoColumn(cell(heading('H')), cell(para('R0'))));
    const { state } = backspaceAtStartOf(document, 'H');

    // First Backspace turns the heading into a paragraph in place; the split stays.
    const tc = twoColumnOf(state.doc);
    expect(tc).not.toBeNull();
    expect(tc!.child(1).child(1).type.name).toBe('paragraph');
    expect(cellTexts(tc!, true)).toEqual(['H']);
  });

  it('still merges a plain top-level block up, outside any split', () => {
    const document = doc(para('a'), para('b'));
    const { state } = backspaceAtStartOf(document, 'b');
    expect(state.doc.childCount).toBe(1);
    expect(lineText(state.doc.child(0))).toBe('ab');
  });
});

// --- merge targets ----------------------------------------------------------

/** The text sitting in the first divider's line, which nothing on screen draws. */
function dividerText(document: PMNode): string {
  let text: string | null = null;
  document.descendants((node) => {
    if (text !== null) return false;
    if (node.type.name !== 'divider') return true;
    text = lineText(node);
    return false;
  });
  return text ?? '';
}

/** Every table cell's text, in document order. */
function tableCellTexts(document: PMNode): string[] {
  const out: string[] = [];
  document.descendants((node) => {
    if (node.type.name === 'tableCell') out.push(lineText(node));
    return true;
  });
  return out;
}

describe('two-column Backspace refuses a merge target the caret cannot reach', () => {
  it('leaves a divider above the split alone rather than writing into its hidden line', () => {
    const document = doc(divider(), twoColumn(cell(para('left one')), cell(para('right one'))));
    const before = stateWith(document);
    const { handled, state } = backspaceAtStartOf(document, 'left one');

    // Swallowed, so no character delete follows either, and the text is still
    // where the user can see it rather than in a line rendered as a bare rule.
    expect(handled).toBe(true);
    expect(state.doc.eq(before.doc)).toBe(true);
    expect(dividerText(state.doc)).toBe('');
  });

  it('does the same for a divider at the foot of the left column, from the right cell', () => {
    const document = doc(
      para('above'),
      twoColumn(cell(para('left one'), divider()), cell(para('right one'))),
    );
    const before = stateWith(document);
    const { handled, state } = backspaceAtStartOf(document, 'right one');

    expect(handled).toBe(true);
    expect(state.doc.eq(before.doc)).toBe(true);
    expect(dividerText(state.doc)).toBe('');
  });

  it('treats a table above the split as one object, never appending into its last cell', () => {
    const document = doc(
      table(tableRow(tableCell('a'), tableCell('b'))),
      twoColumn(cell(para('left one')), cell(para('right one'))),
    );
    const before = stateWith(document);
    const { handled, state } = backspaceAtStartOf(document, 'left one');

    expect(handled).toBe(true);
    expect(state.doc.eq(before.doc)).toBe(true);
    expect(tableCellTexts(state.doc)).toEqual(['a', 'b']);
  });

  it('still merges into the block above the split when it can hold a caret', () => {
    const document = doc(para('above'), twoColumn(cell(para('left one')), cell(para('right one'))));
    const { state } = backspaceAtStartOf(document, 'left one');
    expect(lineText(state.doc.child(0))).toBe('aboveleft one');
  });

  it('still merges into the last block of a split above, which is one', () => {
    const document = doc(
      twoColumn(cell(para('A')), cell(para('B'))),
      twoColumn(cell(para('C')), cell(para('D'))),
    );
    const { state } = backspaceAtStartOf(document, 'C');
    expect(cellTexts(state.doc.child(0), false)).toEqual(['BC']);
  });

  it('leaves a divider alone outside a split too, the case this now matches', () => {
    const document = doc(divider(), para('hello'));
    const { handled, state } = backspaceAtStartOf(document, 'hello');

    expect(handled).toBe(true);
    expect(dividerText(state.doc)).toBe('');
    expect(lineText(state.doc.child(1))).toBe('hello');
  });
});
