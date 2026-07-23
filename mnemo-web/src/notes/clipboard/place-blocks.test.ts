// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { blockSelectionPlugin } from '../selection/block-selection-plugin';
import { placeBlockRun } from './place-blocks';

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

describe('placeBlockRun', () => {
  it('replaces a blank line rather than leaving it behind', () => {
    // doc: para(""), caret inside its line (pos 2).
    const { texts: out } = placed(docOf(para('')), 2, run('pasted'));
    expect(out).toEqual(['pasted']);
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
});
