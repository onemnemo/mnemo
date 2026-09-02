/**
 * The block the caret sits in, as the three coordinates every structural
 * command starts from. Computed once here so a split, a merge, a nesting move
 * and a slash insert all agree on which block "the caret's block" is: the
 * innermost one, so a block inside a column cell or under a list item is found
 * by the same arithmetic as a top-level one.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

export interface BlockContext {
  /** The block whose line holds the caret, the innermost one, so a nested cell works. */
  readonly block: PMNode;
  /** Position immediately before `block`. */
  readonly blockPos: number;
  /** The block's line (or codeLine) node. */
  readonly line: PMNode;
  /** Caret offset within the line's content. */
  readonly offset: number;
}

/**
 * The block the caret sits in, or null when the selection is not inside an
 * editable line (a node selection on an atom, say).
 */
export function blockContext(state: EditorState): BlockContext | null {
  const { $from } = state.selection;
  const line = $from.parent;
  // The caret must be in inline content; doc > block > line means the line's
  // parent is always the block, one level up.
  if (!line.isTextblock || $from.depth < 1) return null;
  const blockDepth = $from.depth - 1;
  return {
    block: $from.node(blockDepth),
    blockPos: $from.before(blockDepth),
    line,
    offset: $from.parentOffset,
  };
}
