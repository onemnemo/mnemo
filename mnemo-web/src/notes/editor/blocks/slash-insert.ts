/**
 * What a slash-menu row does: turn the block the caret is in into the block the
 * row names, and take the typed `/query` with it.
 *
 * Two variants, differing only in where the caret ends up. Most blocks have a
 * line to keep typing in; the ones that draw themselves from their payload do
 * not, and those go through {@link insertAtomicBlock}.
 *
 * Every row goes through `convertBlockType`, so the block keeps its id, sid,
 * order and meta. That matters more here than it looks: a sid is the name the
 * AI has already seen and quoted back, and a delete-and-reinsert would mint a
 * new one for what the user experiences as the same block changing shape.
 *
 * The line is cleared rather than kept, matching the desktop, and the trigger
 * text goes with it: the `/query` was a command, not content. The menu only
 * opens on a line with no inline atom, so clearing cannot destroy an equation
 * that carries no text of its own.
 */

import { TextSelection } from 'prosemirror-state';
import { blockContext, convertBlockType } from '../commands/structure';
import type { SlashContribution } from '../registry/types';
import { createTable } from '../table/model';
import { lineIsCaretTarget } from './shared';

/**
 * The page row: create the nested note first, then put a card in front of it.
 *
 * The order is the whole point, and it is why a slash insert is allowed to be
 * async at all. A card stores an id and nothing else, so writing one before the
 * note exists would leave the document holding a reference to nothing, which the
 * card would honestly but uselessly render as a missing note. The desktop does
 * the same thing for the same reason.
 *
 * The step is built from the state as it is after the request, not from the one
 * the row was picked in: the user can go on typing while it is in flight, and a
 * step mapped against the older document lands in the wrong place.
 */
export const insertPageBlock: SlashContribution['insert'] = async (_state, dispatch, context) => {
  const create = context?.services.notes?.createChild;
  if (!create || !context) return;

  let referenceNoteId: string;
  try {
    referenceNoteId = await create();
  } catch {
    // The note is what the card would point at; with no note there is nothing
    // honest to insert. The failure is reported where the request is made.
    return;
  }

  insertAtomicBlock('page', { referenceNoteId })(context.currentState(), dispatch);
};

/**
 * The two-column row: replace the current block with a fresh split, an empty text
 * block seeded in each cell, and land the caret in the left one.
 *
 * Where the desktop deletes the block and inserts a new two-column (a new id),
 * this rebuilds in place, so the block keeps its id, sid, order and meta, the same
 * identity rule every other row here follows. The line is dropped with its slash
 * query, which was a command. `nativeTwoColumn` marks the split as menu-made,
 * which on the desktop is what stops a drag-out from dissolving it.
 *
 * Refused inside an existing split, matching the desktop: the menu only ever
 * makes a two-column at the top level, and nesting arrives through paste.
 */
export const insertTwoColumn: SlashContribution['insert'] = (state, dispatch) => {
  const ctx = blockContext(state);
  if (!ctx) return;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth).type.name === 'twoColumn') return;
  }
  const { twoColumn, columnGroup, paragraph, line } = state.schema.nodes;
  if (!twoColumn || !columnGroup || !paragraph || !line) return;

  const seededCell = () =>
    columnGroup.create(null, [line.create(), paragraph.create(null, line.create())]);
  const tc = twoColumn.create(
    {
      id: ctx.block.attrs.id,
      sid: ctx.block.attrs.sid,
      order: ctx.block.attrs.order,
      meta: { ...((ctx.block.attrs.meta as Record<string, unknown>) ?? {}), nativeTwoColumn: true },
    },
    [line.create(), seededCell(), seededCell()],
  );

  const tr = state.tr.replaceWith(ctx.blockPos, ctx.blockPos + ctx.block.nodeSize, tc);
  // Into the left cell's seeded paragraph: past the container's line, into the
  // left cell past its own line, then into the paragraph's line.
  const emptyLine = line.create().nodeSize;
  const caret = ctx.blockPos + 1 + emptyLine + 1 + emptyLine + 2;
  tr.setSelection(TextSelection.create(tr.doc, caret));
  dispatch(tr.scrollIntoView());
};

/**
 * The table row: replace the current block with a blank three by three and land
 * the caret in the top left cell.
 *
 * Rebuilt in place like the two-column row, so the block keeps the id and sid the
 * AI may already have quoted. Refused inside a table, because a table in a cell
 * is a shape the chrome has no way to point at and nothing in the product creates
 * one deliberately; imported data still renders, since the schema permits it.
 */
export const insertTable: SlashContribution['insert'] = (state, dispatch) => {
  const ctx = blockContext(state);
  if (!ctx) return;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth).type.name === 'table') return;
  }
  if (!state.schema.nodes.table) return;

  const fresh = createTable(state.schema);
  const table = fresh.type.create(
    {
      ...fresh.attrs,
      id: ctx.block.attrs.id,
      sid: ctx.block.attrs.sid,
      order: ctx.block.attrs.order,
      meta: ctx.block.attrs.meta,
    },
    fresh.content,
  );

  const tr = state.tr.replaceWith(ctx.blockPos, ctx.blockPos + ctx.block.nodeSize, table);
  // Into the first cell's line: past the table's boundary and its own line, past
  // the row's boundary and its line, then past the cell's boundary and its line.
  const emptyLine = state.schema.nodes.line.create().nodeSize;
  tr.setSelection(
    TextSelection.create(tr.doc, ctx.blockPos + 1 + emptyLine + 1 + emptyLine + 2),
  );
  dispatch(tr.scrollIntoView());
};

export function convertHere(
  nodeName: string,
  attrs?: Record<string, unknown>,
): SlashContribution['insert'] {
  return (state, dispatch) => {
    const ctx = blockContext(state);
    if (!ctx) return;
    const target = state.schema.nodes[nodeName];
    if (!target) return;

    const tr = state.tr;
    convertBlockType(tr, ctx.blockPos, ctx.block, target, { attrs, content: 'clear' });
    // Two positions in: past the block's own boundary and past the line's.
    tr.setSelection(TextSelection.create(tr.doc, ctx.blockPos + 2));
    dispatch(tr.scrollIntoView());
  };
}

/**
 * The same conversion, for a block that draws itself and has no line to type in.
 *
 * Two things follow from the block being caret-less, and the desktop does both.
 * An editable block is put below it when there is not already one there, so the
 * document never ends with something the caret cannot get past. And the caret
 * goes into that block rather than into the converted one, because the position
 * inside a caret-less block's line renders no DOM: a selection there is a caret
 * the user cannot see and the arrows cannot leave.
 *
 * The desktop instead focuses the block it just converted, which for an equation
 * is a call that does nothing, leaving focus wherever it happened to be. Landing
 * in the block below is the deliberate divergence: it is where typing should
 * continue, and it is what the same code path already does when it does insert.
 */
export function insertAtomicBlock(
  nodeName: string,
  attrs?: Record<string, unknown>,
): SlashContribution['insert'] {
  return (state, dispatch) => {
    const ctx = blockContext(state);
    if (!ctx) return;
    const target = state.schema.nodes[nodeName];
    if (!target) return;
    const { paragraph, line } = state.schema.nodes;

    const tr = state.tr;
    convertBlockType(tr, ctx.blockPos, ctx.block, target, { attrs, content: 'clear' });

    // Read after the conversion: it can change the block's size, and the next
    // sibling's position moves with it.
    const converted = tr.doc.nodeAt(ctx.blockPos);
    const below = ctx.blockPos + (converted?.nodeSize ?? ctx.block.nodeSize);
    const next = tr.doc.resolve(below).nodeAfter;

    if (!next || !lineIsCaretTarget(next.type)) {
      tr.insert(below, paragraph.create(null, line.create()));
    }
    tr.setSelection(TextSelection.create(tr.doc, below + 2));
    dispatch(tr.scrollIntoView());
  };
}
