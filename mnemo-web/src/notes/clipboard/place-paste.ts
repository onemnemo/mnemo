/**
 * The one way a paste reaches the document.
 *
 * Four sources put content on the clipboard: our own copy, a cell grid, another
 * app's HTML, and plain text. What happens to any of them is decided by where
 * the caret is, not by where the content came from, so those decisions live here
 * rather than in each source's own branch, where a rule written for one source
 * is silently missing from the next:
 *
 *  - whole blocks are selected: the run takes their place, rather than landing
 *    beside the collapsed caret the block selection left behind;
 *  - the caret is in a source line: content is literal there, so the run's text
 *    is inserted and the code block stays one block;
 *  - the caret is in a table cell: a cell is one run of prose, so a run of
 *    blocks folds into it instead of nesting;
 *  - otherwise a run of blocks splits in like an Enter split, and an inline run
 *    merges into the line at the caret.
 */

import { Fragment, Slice, type Schema } from 'prosemirror-model';
import { Selection, type EditorState, type Transaction } from 'prosemirror-state';

import type { BlockRegistry } from '../editor/registry/build';
import { blockContext } from '../editor/commands/structure';
import { buildCrossBlockDelete } from '../editor/commands/range-delete';
import { getBlockSelection } from '../selection/block-selection-plugin';
import { placeBlockRun, replaceSelectedBlocks } from './place-blocks';

/**
 * How the content wants to land when nothing about the caret overrides it:
 * `blocks` splits in as siblings, `merge` joins the line at the caret.
 */
export type PasteShape = 'blocks' | 'merge';

/** Build the insertion transaction for pasted `content` against `state`. */
export function placePaste(
  state: EditorState,
  content: Slice,
  shape: PasteShape,
  registry: BlockRegistry,
): Transaction {
  const { selected } = getBlockSelection(state);
  if (selected.size > 0) {
    const replaced = replaceSelectedBlocks(state, asBlockRun(state.schema, content), registry, selected);
    if (replaced) return replaced;
  }
  const crossBlock = buildCrossBlockDelete(state);
  if (crossBlock) return placeAfterDelete(state, crossBlock.tr, content, shape, registry);
  if (inSourceLine(state)) return state.tr.insertText(textOf(content));
  if (shape === 'blocks' || (isBlockRun(content) && inTableCell(state))) {
    return placeBlockRun(state, content);
  }
  return state.tr.replaceSelection(content);
}

/**
 * A paste over a range that spans blocks: the range goes first, through the
 * same delete the keys use, so a container the range reaches into keeps its
 * shape instead of being torn open by the generic replace, and the content then
 * lands at the caret the delete left. Both are folded into one transaction so
 * the paste stays one undo step, with the repairs the delete provoked carried
 * along, since the placement was built on the document they produced.
 */
function placeAfterDelete(
  state: EditorState,
  deletion: Transaction,
  content: Slice,
  shape: PasteShape,
  registry: BlockRegistry,
): Transaction {
  const applied = state.applyTransaction(deletion);
  const placed = placePaste(applied.state, content, shape, registry);
  const tr = state.tr;
  for (const transaction of applied.transactions) {
    for (const step of transaction.steps) tr.step(step);
  }
  for (const step of placed.steps) tr.step(step);
  return tr.setSelection(Selection.fromJSON(tr.doc, placed.selection.toJSON()));
}

/** True when the caret sits in a code or sketch line, where content is literal. */
export function inSourceLine(state: EditorState): boolean {
  return state.selection.$from.parent.type.name === 'codeLine';
}

function inTableCell(state: EditorState): boolean {
  return blockContext(state)?.block.type.name === 'tableCell';
}

const isBlockRun = (content: Slice): boolean => content.content.firstChild?.isBlock === true;

/** The run's text, one line per block, as a source line takes it. */
function textOf(content: Slice): string {
  return content.content.textBetween(0, content.content.size, '\n');
}

/**
 * The content as top-level blocks. Replacing selected blocks inserts blocks, so
 * an inline run needs one of its own to arrive in.
 */
function asBlockRun(schema: Schema, content: Slice): Slice {
  if (isBlockRun(content)) return content;
  const line = schema.nodes.line.create(null, content.content);
  return new Slice(Fragment.from(schema.nodes.paragraph.create(null, line)), 0, 0);
}
