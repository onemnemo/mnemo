// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { invariantPipeline } from '../pipeline/invariants';
import { lineText } from '../blocks/shared';
import { escapeLastBlock } from './document-end';
import { splitBlock } from './structure';

const { schema, registry } = createEditorSchema();
const escape = escapeLastBlock(splitBlock);

// --- builders ---------------------------------------------------------------

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function codeLine(text?: string): PMNode {
  return schema.nodes.codeLine.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function quote(text: string): PMNode {
  return schema.nodes.quote.create(null, line(text));
}
function code(text: string): PMNode {
  return schema.nodes.codeBlock.create({ language: 'csharp' }, codeLine(text));
}
function cell(text: string): PMNode {
  return schema.nodes.tableCell.create(null, line(text));
}
function tableRow(...cells: PMNode[]): PMNode {
  return schema.nodes.tableRow.create(null, [line(), ...cells]);
}
function table(...rows: PMNode[]): PMNode {
  return schema.nodes.table.create({ columnWidths: [] }, [line(), ...rows]);
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

/** Position at the end of the line of the first block, at any depth, reading `text`. */
function caretAtEndOf(document: PMNode, text: string): number {
  let pos: number | null = null;
  document.descendants((node, at) => {
    if (pos !== null) return false;
    if (node.isTextblock) return false;
    if (lineText(node) === text && node.firstChild) {
      pos = at + 2 + node.firstChild.content.size;
      return false;
    }
    return true;
  });
  if (pos === null) throw new Error(`no block with line text ${JSON.stringify(text)}`);
  return pos;
}

function run(document: PMNode, from: number, to = from): { state: EditorState; handled: boolean } {
  const state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, from, to),
    plugins: [invariantPipeline(registry)],
  });
  let next = state;
  const handled = (escape as Command)(state, (tr) => {
    next = state.apply(tr);
  });
  return { state: next, handled };
}

// --- the blocks a note can end in -------------------------------------------

describe('escaping the block a note ends with', () => {
  it('adds a Text block after a trailing code block and puts the caret in it', () => {
    const document = doc(para('intro'), code('let x = 1'));
    const { state, handled } = run(document, caretAtEndOf(document, 'let x = 1'));

    expect(handled).toBe(true);
    expect(state.doc.childCount).toBe(3);
    expect(state.doc.child(2).type.name).toBe('paragraph');
    expect(state.doc.child(2).textContent).toBe('');
    expect(state.selection.$from.parent.type.name).toBe('line');
    expect(state.selection.$from.node(1).type.name).toBe('paragraph');
    state.doc.check();
  });

  it('does the same from the last cell of a trailing table', () => {
    const document = doc(table(tableRow(cell('a'), cell('b'))));
    const { state, handled } = run(document, caretAtEndOf(document, 'b'));

    expect(handled).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(1).type.name).toBe('paragraph');
  });

  it('does the same from a trailing quote, whose Enter is a soft wrap', () => {
    const document = doc(quote('a thought'));
    const { state, handled } = run(document, caretAtEndOf(document, 'a thought'));

    expect(handled).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(0).type.name).toBe('quote');
    expect(state.doc.child(1).type.name).toBe('paragraph');
  });

  it('lands at the top level when the trailing block is inside a split', () => {
    const document = doc(twoColumn(columnCell(para('left')), columnCell(code('src'))));
    const { state, handled } = run(document, caretAtEndOf(document, 'src'));

    expect(handled).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(1).type.name).toBe('paragraph');
    state.doc.check();
  });
});

// --- and the ones it declines ------------------------------------------------

describe('the end-of-note escape declines', () => {
  it('at the end of a paragraph, where Enter already makes the block below', () => {
    const document = doc(para('done'));
    expect(run(document, caretAtEndOf(document, 'done')).handled).toBe(false);
  });

  it('at the end of a heading or a list item, for the same reason', () => {
    const heading = schema.nodes.heading.create({ level: 1 }, line('Title'));
    const bullet = schema.nodes.bulletItem.create(null, line('milk'));
    expect(run(doc(heading), caretAtEndOf(doc(heading), 'Title')).handled).toBe(false);
    expect(run(doc(bullet), caretAtEndOf(doc(bullet), 'milk')).handled).toBe(false);
  });

  it('when a block already follows the code block', () => {
    const document = doc(code('let x = 1'), para('after'));
    expect(run(document, caretAtEndOf(document, 'let x = 1')).handled).toBe(false);
  });

  it('when the caret is not at the end of the source', () => {
    const document = doc(code('let x = 1'));
    expect(run(document, caretAtEndOf(document, 'let x = 1') - 1).handled).toBe(false);
  });

  it('at the end of a line that is not the last one in the source', () => {
    const document = doc(code('one\ntwo'));
    const endOfFirst = caretAtEndOf(document, 'one\ntwo') - 'two'.length - 1;
    expect(run(document, endOfFirst).handled).toBe(false);
  });

  it('over a range, which the arrows collapse rather than move', () => {
    const document = doc(code('let x = 1'));
    const end = caretAtEndOf(document, 'let x = 1');
    expect(run(document, end - 3, end).handled).toBe(false);
  });

  it('in a cell that is not the last thing in the table', () => {
    const document = doc(table(tableRow(cell('a'), cell('b'))));
    expect(run(document, caretAtEndOf(document, 'a')).handled).toBe(false);
  });
});
