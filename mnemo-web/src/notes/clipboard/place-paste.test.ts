// @vitest-environment jsdom
/**
 * The placement rules, asserted per paste source rather than per rule: a block
 * selection, a table cell and a source line have to mean the same thing whether
 * the clipboard came from our own copy, from a web page, or from plain text.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorState, Selection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { blockIdentityPlugin } from '../editor/pipeline/block-identity';
import { invariantPipeline } from '../editor/pipeline/invariants';
import { blockSelectionKey, blockSelectionPlugin } from '../selection/block-selection-plugin';
import { clipboardPlugin } from './clipboard-plugin';
import { clearStashedSlice } from './internal-buffer';

const { schema, registry, inline } = createEditorSchema();
const plugin = clipboardPlugin(registry, inline);

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const code = (source: string, sid: string) =>
  schema.nodes.codeBlock.create(
    { sid, id: sid, language: 'ts' },
    schema.nodes.codeLine.create(null, schema.text(source)),
  );
const tableCell = (text: string, sid: string) => schema.nodes.tableCell.create({ sid, id: sid }, line(text));
const tableRow = (...cells: PMNode[]) => schema.nodes.tableRow.create(null, [line(), ...cells]);
const table = (...rows: PMNode[]) => schema.nodes.table.create({ columnWidths: [] }, [line(), ...rows]);
const docOf = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

const views: EditorView[] = [];

function mount(doc: PMNode): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, {
    state: EditorState.create({
      schema,
      doc,
      plugins: [
        blockIdentityPlugin(registry),
        invariantPipeline(registry),
        blockSelectionPlugin(registry),
        plugin,
      ],
    }),
  });
  views.push(view);
  return view;
}

function clipboardOf(entries: Record<string, string>): DataTransfer {
  const store = new Map(Object.entries(entries));
  return {
    setData: (type: string, data: string) => store.set(type, data),
    getData: (type: string) => store.get(type) ?? '',
  } as unknown as DataTransfer;
}

function firePaste(view: EditorView, data: DataTransfer): boolean {
  const event = { clipboardData: data, preventDefault: () => {} } as unknown as ClipboardEvent;
  const handler = plugin.props.handlePaste!;
  return Boolean((handler as (this: Plugin, v: EditorView, e: ClipboardEvent) => boolean).call(plugin, view, event));
}

/** Copies whatever the block selection holds, the way Ctrl+C does. */
function fireCopy(view: EditorView): DataTransfer {
  const data = clipboardOf({});
  const event = { clipboardData: data, preventDefault: () => {} } as unknown as ClipboardEvent;
  const handler = plugin.props.handleDOMEvents!.copy!;
  (handler as (this: Plugin, v: EditorView, e: ClipboardEvent) => boolean).call(plugin, view, event);
  return data;
}

function selectBlocks(view: EditorView, sids: readonly string[]): void {
  view.dispatch(
    view.state.tr.setMeta(blockSelectionKey, {
      type: 'set',
      selection: { selected: new Set(sids), anchorSid: sids[0] },
    }),
  );
}

/** The collapsed caret a block selection leaves behind, at the end of the note. */
function caretAtEnd(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
}

function caretInFirstCell(view: EditorView): void {
  let cellPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (cellPos === -1 && node.type.name === 'tableCell') cellPos = pos;
    return cellPos === -1;
  });
  const cell = view.state.doc.nodeAt(cellPos)!;
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, cellPos + 2 + (cell.firstChild?.content.size ?? 0)),
    ),
  );
}

const textsOf = (view: EditorView): string[] => {
  const out: string[] = [];
  view.state.doc.forEach((node) => out.push(node.textContent));
  return out;
};

/** Block children (past the mandatory line) nested inside any table cell. */
function nestedBlocksInCells(view: EditorView): string[] {
  const out: string[] = [];
  view.state.doc.descendants((node) => {
    if (node.type.name !== 'tableCell') return true;
    node.forEach((child, _offset, index) => {
      if (index > 0) out.push(child.type.name);
    });
    return true;
  });
  return out;
}

describe('a paste over a live block selection', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  const threeParagraphs = () => docOf(para('one', 's1'), para('two', 's2'), para('three', 's3'));

  it('replaces the selected blocks with a run of markdown blocks', () => {
    const view = mount(threeParagraphs());
    caretAtEnd(view);
    selectBlocks(view, ['s1', 's2']);

    expect(firePaste(view, clipboardOf({ 'text/plain': '# Heading\n- item' }))).toBe(true);
    expect(textsOf(view)).toEqual(['Heading', 'item', 'three']);
  });

  it('replaces the selected blocks with a single line of plain text', () => {
    const view = mount(threeParagraphs());
    caretAtEnd(view);
    selectBlocks(view, ['s1', 's2']);

    expect(firePaste(view, clipboardOf({ 'text/plain': 'word' }))).toBe(true);
    expect(textsOf(view)).toEqual(['word', 'three']);
  });

  it('replaces the selected blocks with a web page fragment', () => {
    const view = mount(threeParagraphs());
    caretAtEnd(view);
    selectBlocks(view, ['s1', 's2']);

    const foreign = clipboardOf({ 'text/html': '<p>pasted</p>', 'text/plain': 'pasted' });
    expect(firePaste(view, foreign)).toBe(true);
    expect(textsOf(view)).toEqual(['pasted', 'three']);
  });

  it('pastes at the caret when the selection covers nothing to replace', () => {
    const view = mount(threeParagraphs());
    caretAtEnd(view);
    selectBlocks(view, ['gone']);

    expect(firePaste(view, clipboardOf({ 'text/plain': 'word' }))).toBe(true);
    expect(textsOf(view)).toEqual(['one', 'two', 'threeword']);
  });
});

describe('a paste into a table cell', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  const oneRow = () => docOf(table(tableRow(tableCell('x', 'c1'), tableCell('y', 'c2'))));

  it('folds a run of markdown blocks into the cell as prose', () => {
    const view = mount(oneRow());
    caretInFirstCell(view);

    expect(firePaste(view, clipboardOf({ 'text/plain': '# One\n# Two' }))).toBe(true);
    expect(nestedBlocksInCells(view)).toEqual([]);
  });

  it('folds a web page fragment into the cell rather than nesting blocks in it', () => {
    const view = mount(oneRow());
    caretInFirstCell(view);

    const foreign = clipboardOf({ 'text/html': '<p>one</p><p>two</p>', 'text/plain': 'one\ntwo' });
    expect(firePaste(view, foreign)).toBe(true);
    expect(nestedBlocksInCells(view)).toEqual([]);
    expect(view.state.doc.textContent).toContain('one');
  });
});

describe('a paste over a range that runs into a table', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  /** From after the first character of the paragraph to after the first cell's text. */
  function selectIntoFirstCell(view: EditorView): void {
    let cellPos = -1;
    view.state.doc.descendants((node, pos) => {
      if (cellPos === -1 && node.type.name === 'tableCell') cellPos = pos;
      return cellPos === -1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, cellPos + 2 + 1)));
  }

  it('keeps the table whole and lands the text at the head of the range', () => {
    const view = mount(
      docOf(para('one', 's1'), table(tableRow(tableCell('x', 'c1'), tableCell('y', 'c2'))), para('three', 's3')),
    );
    selectIntoFirstCell(view);

    expect(firePaste(view, clipboardOf({ 'text/plain': 'word' }))).toBe(true);

    const types: string[] = [];
    view.state.doc.forEach((node) => types.push(node.type.name));
    expect(types).toEqual(['paragraph', 'table', 'paragraph']);
    expect(textsOf(view)).toEqual(['oword', 'y', 'three']);
    expect(nestedBlocksInCells(view)).toEqual([]);
  });
});

describe('a plain text paste that carries a pipe table', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  it('lands as a table block with the prose around it', () => {
    const view = mount(docOf(para('', 's1')));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    const text = ['Above the table.', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'Below the table.'].join('\n');

    expect(firePaste(view, clipboardOf({ 'text/plain': text }))).toBe(true);

    const types: string[] = [];
    view.state.doc.forEach((node) => types.push(node.type.name));
    expect(types).toContain('table');
    const cells: string[] = [];
    view.state.doc.descendants((node) => {
      if (node.type.name === 'tableCell') cells.push(node.textContent);
      return true;
    });
    expect(cells).toEqual(['A', 'B', '1', '2']);
    expect(view.state.doc.textContent).toContain('Above the table.');
    expect(view.state.doc.textContent).toContain('Below the table.');
  });
});

describe('a paste into the middle of a code block', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  const SOURCE = 'const a = 1;\nconst b = 2;';
  const HEAD = 'const a = 1;';

  /** Copies the paragraph by its grip, then puts the caret between the two source lines. */
  function copyParagraphThenCaretMidCode(view: EditorView): DataTransfer {
    selectBlocks(view, ['p1']);
    const data = fireCopy(view);
    const codePos = view.state.doc.child(0).nodeSize;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, codePos + 2 + HEAD.length)),
    );
    return data;
  }

  it('takes copied blocks as literal source, leaving the code block whole', () => {
    const view = mount(docOf(para('note', 'p1'), code(SOURCE, 'c1')));
    const data = copyParagraphThenCaretMidCode(view);

    expect(firePaste(view, data)).toBe(true);

    const shape: string[] = [];
    view.state.doc.forEach((node) => shape.push(`${node.type.name}:${node.textContent}`));
    expect(shape).toEqual(['paragraph:note', `codeBlock:${HEAD}note\nconst b = 2;`]);
  });
});
