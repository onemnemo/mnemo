/**
 * Nesting a list item under its neighbour, and lifting it back out.
 *
 * A nested list is nothing but block children: an item's sub-list is the block
 * nodes after its line, which is exactly the `children` the wire format already
 * carries for every block. So neither command touches the schema or invents a
 * depth attribute. Indent moves the caret's item, sub-list and all, to the end
 * of the item above it; outdent moves it out after its parent and hands it the
 * siblings that followed it, so an item lifted from the middle of a sub-list
 * keeps the rest of that sub-list beneath it, the way every outliner reads.
 *
 * Only a list item indents, and only under another list item. A paragraph
 * that ends up nested (an item de-formatted in place keeps its position) can
 * still be lifted out, so nothing a user can build is a state the keys cannot
 * undo. Tab and Shift+Tab claim the key only when the caret is in a list item
 * or a nested block: everywhere else they decline, and the browser moves focus
 * exactly as it did before.
 *
 * Both moves are one transaction and one undo step, and both carry the node
 * across unchanged, so `id`, `sid`, `order` and `meta` survive, and the sid the
 * AI may already have named still points at the same item afterwards.
 */

import { keymap } from 'prosemirror-keymap';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Plugin, type Transaction } from 'prosemirror-state';
import { isListItem } from '../blocks/shared';
import { asOwnUndoStep } from '../history';
import { blockContext } from './caret-block';

/**
 * The transaction that nests the block at `pos` under the list item before it,
 * or null when there is no such item or the block is not a list item itself.
 */
export function indentTransaction(state: EditorState, pos: number, node: PMNode): Transaction | null {
  if (!isListItem(node)) return null;
  const prev = state.doc.resolve(pos).nodeBefore;
  if (!prev || !isListItem(prev)) return null;
  const prevPos = pos - prev.nodeSize;
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  // Just inside the previous item's closing token, so the block becomes its last
  // child. That position precedes the deletion and needs no mapping.
  return tr.insert(prevPos + prev.nodeSize - 1, node);
}

/** Where the block lands after {@link indentTransaction}: one position earlier, inside its new parent. */
function indentedPos(pos: number): number {
  return pos - 1;
}

/**
 * The transaction that lifts the block at `pos` out of the list item holding
 * it, placing it right after that item with the item's remaining children as
 * its own, or null when the block is not inside a list item.
 */
export function outdentTransaction(state: EditorState, pos: number, node: PMNode): Transaction | null {
  const $pos = state.doc.resolve(pos);
  if ($pos.depth < 1) return null;
  const parent = $pos.parent;
  if (!isListItem(parent)) return null;
  const parentPos = $pos.before($pos.depth);
  const index = $pos.index();

  const kept: PMNode[] = [];
  const trailing: PMNode[] = [];
  parent.forEach((child, _offset, i) => {
    if (i < index) kept.push(child);
    else if (i > index) trailing.push(child);
  });

  const shortened = parent.copy(Fragment.from(kept));
  const lifted = node.copy(node.content.append(Fragment.from(trailing)));
  return state.tr.replaceWith(parentPos, parentPos + parent.nodeSize, [shortened, lifted]);
}

/**
 * Where the block lands after {@link outdentTransaction}: one position later.
 * The parent keeps everything up to the block and then closes, and that closing
 * token is the one token that now sits between the block's old and new place.
 */
function outdentedPos(pos: number): number {
  return pos + 1;
}

/** Whether the block at `pos` sits inside a list item. */
export function isNested(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  return $pos.depth >= 1 && isListItem($pos.parent);
}

/**
 * Runs a nesting move under the caret, keeping the caret at the same offset in
 * the moved block. The block's interior is unchanged by either move, so every
 * position inside it shifts by the block's own displacement.
 */
function moveUnderCaret(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  build: (pos: number, node: PMNode) => Transaction | null,
  landing: (pos: number) => number,
): boolean {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.$from.sameParent(sel.$to)) return false;
  const ctx = blockContext(state);
  if (!ctx) return false;
  const tr = build(ctx.blockPos, ctx.block);
  if (!tr) return false;
  if (dispatch) {
    const delta = landing(ctx.blockPos) - ctx.blockPos;
    tr.setSelection(TextSelection.create(tr.doc, sel.from + delta, sel.to + delta));
    dispatch(asOwnUndoStep(tr.scrollIntoView()));
  }
  return true;
}

/**
 * Tab: nest the caret's list item under the item above it. A first item has
 * nothing to nest under, and the key is still the list's then, so the caret
 * stays where it is rather than leaving the editor.
 */
export const indentListItem: Command = (state, dispatch) => {
  const ctx = blockContext(state);
  if (!ctx || !isListItem(ctx.block)) return false;
  moveUnderCaret(state, dispatch, (pos, node) => indentTransaction(state, pos, node), indentedPos);
  return true;
};

/**
 * Shift+Tab: lift the caret's block out of the list item holding it. A
 * top-level item has nowhere to go and keeps the key all the same, as for Tab.
 */
export const outdentListItem: Command = (state, dispatch) => {
  const ctx = blockContext(state);
  if (!ctx) return false;
  if (!isListItem(ctx.block) && !isNested(state, ctx.blockPos)) return false;
  moveUnderCaret(state, dispatch, (pos, node) => outdentTransaction(state, pos, node), outdentedPos);
  return true;
};

export function listNestingKeyBindings(): Record<string, Command> {
  return {
    Tab: indentListItem,
    'Shift-Tab': outdentListItem,
  };
}

/** The nesting keymap plugin, mounted beside the structural keymap. */
export function listNestingKeymap(): Plugin {
  return keymap(listNestingKeyBindings());
}
