// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Selection, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import {
  GapCursor,
  findGapFrom,
  gapCursorValid,
  gapSearchStart,
  holdsAnyCaret,
} from './gap-cursor';

const { schema } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text?: string) => schema.nodes.paragraph.create(null, line(text));
const divider = () => schema.nodes.divider.create(null, line());
const equation = (latex = 'x^2') => schema.nodes.equationBlock.create({ latex }, line());
const page = () => schema.nodes.page.create({ referenceNoteId: 'n1' }, line());
const image = () => schema.nodes.image.create(null, line('a caption'));
const cell = (...blocks: PMNode[]) => schema.nodes.tableCell.create(null, [line(), ...blocks]);
const row = (...cells: PMNode[]) => schema.nodes.tableRow.create(null, [line(), ...cells]);
const table = (...rows: PMNode[]) => schema.nodes.table.create({ columnWidths: [] }, [line(), ...rows]);
const column = (...blocks: PMNode[]) => schema.nodes.columnGroup.create(null, [line(), ...blocks]);
const twoColumn = (left: PMNode, right: PMNode) =>
  schema.nodes.twoColumn.create(null, [line(), left, right]);
const doc = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

/** Every position in `document` a gap cursor is valid at. */
function gapsIn(document: PMNode): number[] {
  const found: number[] = [];
  for (let pos = 0; pos <= document.content.size; pos++) {
    if (gapCursorValid(document.resolve(pos))) found.push(pos);
  }
  return found;
}

/** The caret at `offset` in the line of the `index`-th top-level block. */
function caretIn(document: PMNode, index: number, offset = 0): number {
  let start = -1;
  document.forEach((_node, pos, at) => {
    if (at === index) start = pos;
  });
  return start + 2 + offset;
}

describe('holdsAnyCaret', () => {
  it('is true for a block whose own line takes the caret', () => {
    expect(holdsAnyCaret(para('text'))).toBe(true);
    // The caption is a real line, so an image is not one of these blocks.
    expect(holdsAnyCaret(image())).toBe(true);
  });

  it('is false for the blocks that draw themselves from their payload', () => {
    expect(holdsAnyCaret(divider())).toBe(false);
    expect(holdsAnyCaret(equation())).toBe(false);
    expect(holdsAnyCaret(page())).toBe(false);
  });

  it('is true for a container, whose cells hold the caret its own line does not', () => {
    expect(holdsAnyCaret(table(row(cell(para('a')))))).toBe(true);
    expect(holdsAnyCaret(twoColumn(column(para('a')), column(para('b'))))).toBe(true);
  });
});

describe('gapCursorValid', () => {
  it('offers one above a note that starts with a divider, and nowhere else', () => {
    expect(gapsIn(doc(divider(), para('after')))).toEqual([0]);
  });

  it('offers one below a note that ends with an equation', () => {
    const document = doc(para('before'), equation());
    expect(gapsIn(document)).toEqual([document.content.size]);
  });

  it('offers one between two blocks that both hold no caret', () => {
    const document = doc(para('a'), divider(), equation(), para('b'));
    expect(gapsIn(document)).toEqual([document.child(0).nodeSize + document.child(1).nodeSize]);
  });

  it('offers none where an ordinary block already has a caret at the boundary', () => {
    expect(gapsIn(doc(para('one'), para('two')))).toEqual([]);
    expect(gapsIn(doc(image(), para('after')))).toEqual([]);
  });

  it('offers none among a table or a two-column, whose children are their structure', () => {
    expect(gapsIn(doc(table(row(cell(para('a')), cell(para('b'))))))).toEqual([]);
    expect(gapsIn(doc(twoColumn(column(para('a')), column(para('b')))))).toEqual([]);
  });

  it('offers one inside a column cell that starts with a divider', () => {
    const document = doc(twoColumn(column(divider(), para('a')), column(para('b'))));
    // Past the row's own line and the cell's, which is where the cell's blocks begin.
    const at = 1 + line().nodeSize + 1 + line().nodeSize;
    expect(gapsIn(document)).toEqual([at]);
  });

  it('offers one after a nested divider, where the sub-list ends', () => {
    const item = schema.nodes.bulletItem.create(null, [line('item'), divider()]);
    const document = doc(item);
    // Not above the divider, where the item's own line already ends, but below
    // it, where the item runs out and nothing else takes the caret.
    expect(gapsIn(document)).toEqual([1 + line('item').nodeSize + divider().nodeSize]);
  });
});

describe('findGapFrom', () => {
  it('finds the gap above a leading divider from the block below it', () => {
    const document = doc(divider(), para('after'));
    const $caret = document.resolve(caretIn(document, 1));
    expect(findGapFrom(gapSearchStart($caret, -1), -1, false)?.pos).toBe(0);
  });

  it('finds the gap below a trailing equation from the block above it', () => {
    const document = doc(para('before'), equation());
    const $caret = document.resolve(caretIn(document, 0, 'before'.length));
    expect(findGapFrom(gapSearchStart($caret, 1), 1, false)?.pos).toBe(document.content.size);
  });

  it('stops at a block that holds a caret rather than stepping over it', () => {
    const document = doc(para('one'), para('two'), divider());
    const $caret = document.resolve(caretIn(document, 0, 'one'.length));
    expect(findGapFrom(gapSearchStart($caret, 1), 1, false)).toBeNull();
  });

  it('walks one gap at a time across a run of caret-less blocks', () => {
    const document = doc(divider(), equation(), para('after'));
    const $caret = document.resolve(caretIn(document, 2));
    const first = findGapFrom(gapSearchStart($caret, -1), -1, false);
    expect(first?.pos).toBe(document.child(0).nodeSize);
    const second = findGapFrom(first!, -1, true);
    expect(second?.pos).toBe(0);
    expect(findGapFrom(second!, -1, true)).toBeNull();
  });

  it('finds nothing between two ordinary blocks', () => {
    const document = doc(para('one'), para('two'));
    const $caret = document.resolve(caretIn(document, 0, 'one'.length));
    expect(findGapFrom(gapSearchStart($caret, 1), 1, false)).toBeNull();
  });
});

describe('the GapCursor selection', () => {
  it('is empty, invisible, and carries no content', () => {
    const document = doc(divider(), para('after'));
    const gap = new GapCursor(document.resolve(0));
    expect(gap.empty).toBe(true);
    expect(gap.visible).toBe(false);
    expect(gap.content().size).toBe(0);
    expect(gap.eq(new GapCursor(document.resolve(0)))).toBe(true);
  });

  it('round-trips through JSON, which the paste and identity paths depend on', () => {
    const document = doc(divider(), para('after'));
    const gap = new GapCursor(document.resolve(0));
    const restored = Selection.fromJSON(document, gap.toJSON());
    expect(restored).toBeInstanceOf(GapCursor);
    expect(restored.head).toBe(0);
  });

  it('gives up the gap when a mapped position no longer has one', () => {
    const document = doc(divider(), para('after'));
    const gap = new GapCursor(document.resolve(0));
    const tr = { map: () => 0, mapResult: () => ({ pos: 0, deleted: false }) };
    const filled = doc(para('now here'), divider(), para('after'));
    const mapped = gap.map(filled, tr as never);
    expect(mapped).not.toBeInstanceOf(GapCursor);
    expect(mapped).toBeInstanceOf(TextSelection);
  });
});
