// @vitest-environment node

/**
 * The table header and column splitter sets are mapped through each change and
 * rebuilt only where it landed. After every step they must equal what a rebuild
 * of the whole document gives.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { ReplaceAroundStep } from 'prosemirror-transform';
import { history, redo, undo } from 'prosemirror-history';
import type { Decoration } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { TABLE_COL_W, toggleColumnHeader, toggleRowHeader } from '../table/model';
import { tableHeaderDecorations, tableHeaderPlugin } from '../table/header-decorations';
import { columnSplitterDecorations, columnSplitterPlugin } from './column-splitter';

const { schema } = createEditorSchema();

let sidCounter = 0;
const sid = () => `r${String((sidCounter += 1)).padStart(4, '0')}`;

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string) => schema.nodes.paragraph.create({ sid: sid() }, line(text));
const lane = (...blocks: PMNode[]) => schema.nodes.columnGroup.create({ sid: sid() }, [line(), ...blocks]);
const split = (left: PMNode[], right: PMNode[], id = sid()) =>
  schema.nodes.twoColumn.create({ sid: id }, [line(), lane(...left), lane(...right)]);
const cell = (text: string) => schema.nodes.tableCell.create({ sid: sid() }, line(text));
const row = (...texts: string[]) => schema.nodes.tableRow.create({ sid: sid() }, [line(), ...texts.map(cell)]);
const table = (headerRow = false) =>
  schema.nodes.table.create(
    { sid: sid(), columnWidths: [TABLE_COL_W, TABLE_COL_W], headerRows: [headerRow, false], headerColumns: [false, true] },
    [line(), row('a', 'b'), row('c', 'd')],
  );

const headerPlugin = tableHeaderPlugin();
const splitterPlugin = columnSplitterPlugin();

function describeSet(decos: readonly Decoration[]): string[] {
  return decos
    .map((deco) => {
      const spec = deco.spec as { key?: string };
      const attrs = (deco as unknown as { type: { attrs?: { class?: string } } }).type.attrs;
      return `${String(deco.from)}-${String(deco.to)}:${spec.key ?? attrs?.class ?? ''}`;
    })
    .sort();
}

function expectInStep(state: EditorState): void {
  expect(describeSet(headerPlugin.getState(state)!.find())).toEqual(describeSet(tableHeaderDecorations(state.doc)));
  expect(describeSet(splitterPlugin.getState(state)!.find())).toEqual(describeSet(columnSplitterDecorations(state.doc)));
}

/** Every position inside a line, where typing lands. */
function textPositions(doc: PMNode): number[] {
  const out: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) out.push(pos + 1, pos + 1 + node.content.size);
    return !node.isTextblock;
  });
  return out;
}

function topLevelStarts(doc: PMNode): number[] {
  const out: number[] = [];
  doc.forEach((_child, offset) => out.push(offset));
  return out;
}

function firstOf(doc: PMNode, type: string): number {
  const at = topLevelStarts(doc).find((pos) => doc.nodeAt(pos)!.type.name === type);
  if (at === undefined) throw new Error(`no top-level ${type}`);
  return at;
}

function start(): EditorState {
  const doc = schema.nodes.doc.create(null, [
    para('top'),
    table(true),
    split([para('left'), table()], [para('right')]),
    para('middle'),
    split([split([para('a')], [para('b')])], [para('c')]),
    table(),
    para('end'),
  ]);
  return EditorState.create({ schema, doc, plugins: [headerPlugin, splitterPlugin, history()] });
}

describe('range-local table header and splitter decorations', () => {
  it('match a whole-document rebuild through scripted edits', () => {
    let state = start();
    expectInStep(state);
    const step = (change: (tr: Transaction) => Transaction) => {
      state = state.apply(change(state.tr));
      expectInStep(state);
    };

    step((tr) => tr.insertText('typed above ', 2));
    // Inside a table cell, inside a column lane, inside a nested split.
    for (const pos of textPositions(state.doc).slice(2, 12)) step((tr) => tr.insertText('x', pos));

    const tablePos = firstOf(state.doc, 'table');
    const tableAt = () => state.doc.nodeAt(tablePos)!;
    step((tr) => tr.replaceWith(tablePos, tablePos + tableAt().nodeSize, toggleRowHeader(tableAt(), 1)));
    step((tr) => tr.replaceWith(tablePos, tablePos + tableAt().nodeSize, toggleColumnHeader(tableAt(), 0)));
    // Attribute steps map no range at all.
    step((tr) => tr.setNodeAttribute(tablePos, 'headerRows', [false, true]));
    const splitPos = firstOf(state.doc, 'twoColumn');
    const splitAt = () => state.doc.nodeAt(splitPos)!;
    step((tr) => tr.setNodeAttribute(splitPos, 'splitRatio', 0.3));
    step((tr) => tr.setNodeAttribute(splitPos, 'sid', 'r9999'));
    step((tr) => tr.setNodeMarkup(splitPos, undefined, { ...splitAt().attrs, splitRatio: 0.6 }));

    // Delete a split, insert new ones, delete a table, paste a table into a lane.
    step((tr) => tr.delete(splitPos, splitPos + splitAt().nodeSize));
    step((tr) => tr.insert(0, split([para('new')], [table(true)])));
    step((tr) => tr.insert(state.doc.content.size, [table(true), split([para('l')], [para('r')])]));
    const someTable = firstOf(state.doc, 'table');
    step((tr) => tr.delete(someTable, someTable + state.doc.nodeAt(someTable)!.nodeSize));
    const laneText = textPositions(state.doc)[4];
    step((tr) => tr.insert(state.doc.resolve(laneText).after(), table(true)));
    // A range spanning several top-level blocks.
    const starts = topLevelStarts(state.doc);
    step((tr) => tr.delete(starts[1], starts[3]));

    // Wrapping a table in a callout is a ReplaceAroundStep, and undo lifts it back out.
    const wrapAt = firstOf(state.doc, 'table');
    const wrapEnd = wrapAt + state.doc.nodeAt(wrapAt)!.nodeSize;
    const callout = schema.nodes.callout.create({ sid: sid() }, line());
    step((tr) => tr.step(new ReplaceAroundStep(wrapAt, wrapEnd, wrapAt, wrapEnd, new Slice(Fragment.from(callout), 0, 0), 1 + line().nodeSize, true)));
    expect(state.doc.nodeAt(wrapAt)!.type.name).toBe('callout');

    // Backspace across the seam of two adjacent tables, which the schema cannot join.
    step((tr) => tr.insert(0, [table(true), table()]));
    const secondTable = state.doc.child(0).nodeSize;
    step((tr) => tr.delete(secondTable - 3, secondTable + 3));
    state.doc.check();

    // A split with no short id yet, then an edit above it.
    step((tr) => tr.insert(0, split([para('n')], [para('o')], '')));
    step((tr) => tr.insert(0, para('first')));
    step((tr) => tr.insertText('typed ', 2));

    const apply = (command: typeof undo) => {
      command(state, (tr) => {
        state = state.apply(tr);
      });
      expectInStep(state);
    };
    for (let i = 0; i < 12; i++) apply(undo);
    for (let i = 0; i < 12; i++) apply(redo);
  });

  it('match a whole-document rebuild through random edits', () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

    let state = start();
    for (let i = 0; i < 300; i++) {
      const kind = random();
      let tr = state.tr;
      if (kind < 0.6) {
        tr = tr.insertText(pick(['x', 'word ', '']), pick(textPositions(state.doc)));
      } else if (kind < 0.75 && state.doc.childCount > 2) {
        const index = Math.floor(random() * state.doc.childCount);
        const at = topLevelStarts(state.doc)[index];
        tr = tr.delete(at, at + state.doc.child(index).nodeSize);
      } else if (kind < 0.9) {
        tr = tr.insert(pick([...topLevelStarts(state.doc), state.doc.content.size]), pick([table(random() < 0.5), split([para('p')], [table()]), para('q')]));
      } else {
        const at = topLevelStarts(state.doc).find((pos) => state.doc.nodeAt(pos)!.type.name === 'table');
        if (at === undefined) continue;
        tr = tr.setNodeAttribute(at, 'headerRows', [random() < 0.5, random() < 0.5]);
      }
      state = state.apply(tr);
      expectInStep(state);
    }
  });
});
