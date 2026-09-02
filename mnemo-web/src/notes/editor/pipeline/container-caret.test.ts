// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { lineOf } from '../blocks/shared';
import { containerCaretGuard, inCaretlessLine } from './container-caret';

const { schema } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function column(...blocks: PMNode[]): PMNode {
  return schema.nodes.columnGroup.create(null, [line(), ...blocks]);
}
function twoColumn(left: PMNode, right: PMNode): PMNode {
  return schema.nodes.twoColumn.create(null, [line(), left, right]);
}
function divider(): PMNode {
  return schema.nodes.divider.create(null, line());
}
function equation(latex: string): PMNode {
  return schema.nodes.equationBlock.create({ latex }, line());
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

function stateWith(document: PMNode): EditorState {
  return EditorState.create({ schema, doc: document, plugins: [containerCaretGuard()] });
}

/** Position inside the structural line of the first node matching `typeName`. */
function ownLinePos(document: PMNode, typeName: string): number {
  let found = -1;
  document.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === typeName) {
      found = pos + 2; // into the block, into its line
      return false;
    }
    return true;
  });
  return found;
}

/** The line node holding the selection head. */
function headLine(state: EditorState): PMNode {
  return state.selection.$head.parent;
}

const splitDoc = () => doc(para('above'), twoColumn(column(para('L')), column(para('R'))), para('below'));

describe('container caret guard', () => {
  it('recognizes a container line and a caret-less block line alike', () => {
    const state = stateWith(splitDoc());
    const tcLine = state.doc.resolve(ownLinePos(state.doc, 'twoColumn'));
    const cellLine = state.doc.resolve(ownLinePos(state.doc, 'columnGroup'));
    const proseLine = state.doc.resolve(2); // inside "above"
    expect(inCaretlessLine(tcLine)).toBe(true);
    expect(inCaretlessLine(cellLine)).toBe(true);
    expect(inCaretlessLine(proseLine)).toBe(false);

    const atoms = stateWith(doc(para('above'), divider(), equation('E = mc^2'), para('below')));
    expect(inCaretlessLine(atoms.doc.resolve(ownLinePos(atoms.doc, 'divider')))).toBe(true);
    expect(inCaretlessLine(atoms.doc.resolve(ownLinePos(atoms.doc, 'equationBlock')))).toBe(true);
  });

  it('moves a forward-travelling caret out of the split line into the left cell block', () => {
    const state = stateWith(splitDoc());
    const pos = ownLinePos(state.doc, 'twoColumn');
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    expect(headLine(next).textContent).toBe('L');
  });

  it('moves a backward-travelling caret out of a cell line to the block above the split', () => {
    const base = stateWith(splitDoc());
    // Start below the split so the jump into the cell line reads as backward.
    const endPos = base.doc.content.size - 3;
    const seated = base.apply(base.tr.setSelection(TextSelection.create(base.doc, endPos)));
    const cellPos = ownLinePos(seated.doc, 'columnGroup');
    const next = seated.apply(seated.tr.setSelection(TextSelection.create(seated.doc, cellPos)));
    expect(headLine(next).textContent).toBe('above');
  });

  it('turns around at the document edge rather than losing the caret', () => {
    // The split is the first block: backward from its line has nowhere to go.
    const state = stateWith(doc(twoColumn(column(para('L')), column(para('R'))), para('below')));
    const pos = ownLinePos(state.doc, 'twoColumn');
    // Seat the caret after the split first, so the guard reads the move as backward.
    const seated = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 3)),
    );
    const next = seated.apply(seated.tr.setSelection(TextSelection.create(seated.doc, pos)));
    expect(headLine(next).textContent).toBe('L');
  });

  it('leaves an ordinary selection alone', () => {
    const state = stateWith(splitDoc());
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    expect(next.selection.from).toBe(3);
    expect(headLine(next).textContent).toBe('above');
  });

  it('never parks the caret in the hidden line of a nested split', () => {
    const nested = doc(
      para('above'),
      twoColumn(column(twoColumn(column(para('inner L')), column(para('inner R')))), column(para('R'))),
    );
    const state = stateWith(nested);
    const pos = ownLinePos(state.doc, 'twoColumn');
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    // Forward through outer line, outer-left cell line, inner line, inner cell
    // line, all hidden, landing on the first real text.
    expect(headLine(next).textContent).toBe('inner L');
    expect(inCaretlessLine(next.selection.$head)).toBe(false);
  });
});

describe('a block that declares it holds no caret', () => {
  const atomDoc = () => doc(para('above'), equation('E = mc^2'), para('below'));

  it('never keeps the caret in its line', () => {
    const state = stateWith(atomDoc());
    const pos = ownLinePos(state.doc, 'equationBlock');
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    expect(inCaretlessLine(next.selection.$head)).toBe(false);
    expect(headLine(next).textContent).toBe('below');
  });

  it('is stepped over backwards the way a container line is', () => {
    const base = stateWith(atomDoc());
    const seated = base.apply(
      base.tr.setSelection(TextSelection.create(base.doc, base.doc.content.size - 3)),
    );
    const pos = ownLinePos(seated.doc, 'equationBlock');
    const next = seated.apply(seated.tr.setSelection(TextSelection.create(seated.doc, pos)));
    expect(headLine(next).textContent).toBe('above');
  });

  it('is walked past when a run of them stands between the caret and real text', () => {
    const state = stateWith(doc(para('above'), divider(), equation('x'), divider(), para('below')));
    const pos = ownLinePos(state.doc, 'divider');
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    expect(headLine(next).textContent).toBe('below');
  });
});

describe('a range whose anchor is the end sitting in a caret-less line', () => {
  it('relocates the anchor, not only the head', () => {
    const state = stateWith(splitDoc());
    const cellLine = ownLinePos(state.doc, 'columnGroup');
    // Anchor in the cell's hidden line, head in the block inside that cell: the
    // shape a click on the lane's padding and a drag into its text produces.
    const next = state.apply(
      state.tr.setSelection(
        TextSelection.between(state.doc.resolve(cellLine), state.doc.resolve(cellLine + 3)),
      ),
    );
    expect(inCaretlessLine(next.selection.$anchor)).toBe(false);
    expect(inCaretlessLine(next.selection.$head)).toBe(false);
    expect(next.selection.$from.parent.textContent).toBe('L');
  });

  it('relocates the anchor of a backward range too', () => {
    const state = stateWith(splitDoc());
    const cellLine = ownLinePos(state.doc, 'columnGroup');
    const next = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, cellLine, 3)),
    );
    expect(inCaretlessLine(next.selection.$anchor)).toBe(false);
    expect(next.selection.$anchor.parent.textContent).toBe('above');
  });

  it('leaves a range alone when neither end is in one', () => {
    const state = stateWith(splitDoc());
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 5)));
    expect(next.selection.anchor).toBe(2);
    expect(next.selection.head).toBe(5);
  });
});

describe('shared line helpers stay coherent', () => {
  it('containers still expose their structural line to lineOf', () => {
    const tc = twoColumn(column(para('L')), column(para('R')));
    expect(lineOf(tc)).not.toBeNull();
  });
});
