// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { lineOf } from '../blocks/shared';
import { containerCaretGuard, inContainerLine } from './container-caret';

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
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

function stateWith(document: PMNode): EditorState {
  return EditorState.create({ schema, doc: document, plugins: [containerCaretGuard()] });
}

/** Position inside the structural line of the first node matching `typeName`. */
function containerLinePos(document: PMNode, typeName: string): number {
  let found = -1;
  document.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === typeName) {
      found = pos + 2; // into the container, into its line
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
  it('recognizes only container lines', () => {
    const state = stateWith(splitDoc());
    const tcLine = state.doc.resolve(containerLinePos(state.doc, 'twoColumn'));
    const cellLine = state.doc.resolve(containerLinePos(state.doc, 'columnGroup'));
    const proseLine = state.doc.resolve(2); // inside "above"
    expect(inContainerLine(tcLine)).toBe(true);
    expect(inContainerLine(cellLine)).toBe(true);
    expect(inContainerLine(proseLine)).toBe(false);
  });

  it('moves a forward-travelling caret out of the split line into the left cell block', () => {
    const state = stateWith(splitDoc());
    const pos = containerLinePos(state.doc, 'twoColumn');
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    expect(headLine(next).textContent).toBe('L');
  });

  it('moves a backward-travelling caret out of a cell line to the block above the split', () => {
    const base = stateWith(splitDoc());
    // Start below the split so the jump into the cell line reads as backward.
    const endPos = base.doc.content.size - 3;
    const seated = base.apply(base.tr.setSelection(TextSelection.create(base.doc, endPos)));
    const cellPos = containerLinePos(seated.doc, 'columnGroup');
    const next = seated.apply(seated.tr.setSelection(TextSelection.create(seated.doc, cellPos)));
    expect(headLine(next).textContent).toBe('above');
  });

  it('turns around at the document edge rather than losing the caret', () => {
    // The split is the first block: backward from its line has nowhere to go.
    const state = stateWith(doc(twoColumn(column(para('L')), column(para('R'))), para('below')));
    const pos = containerLinePos(state.doc, 'twoColumn');
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
    const pos = containerLinePos(state.doc, 'twoColumn');
    const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    // Forward through outer line, outer-left cell line, inner line, inner cell
    // line, all hidden, landing on the first real text.
    expect(headLine(next).textContent).toBe('inner L');
    expect(inContainerLine(next.selection.$head)).toBe(false);
  });
});

describe('shared line helpers stay coherent', () => {
  it('containers still expose their structural line to lineOf', () => {
    const tc = twoColumn(column(para('L')), column(para('R')));
    expect(lineOf(tc)).not.toBeNull();
  });
});
