/**
 * Assembles the slice a copy or cut puts on the clipboard, read from
 * `state.doc`, never from the DOM.
 *
 * Two sources, in the same precedence the desktop uses. A live Mode A block
 * selection wins: its slice is the whole blocks it covers, taken by the same
 * outermost-coverage rule delete uses, so a fully selected two-column row copies
 * as one unit and a partly selected column contributes only its covered leaves.
 * Otherwise the ordinary text or node selection is copied through ProseMirror's
 * own `selection.content()`.
 *
 * The copied nodes keep their ids and sids; identity is reassigned on paste, not
 * on copy, so the payload can still say which blocks it came from.
 */

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

import type { BlockRegistry } from '../editor/registry/build';
import { getBlockSelection } from '../selection/block-selection-plugin';
import { coveredBlockRanges } from '../selection/delete-selected';
import type { ClipboardMode } from './internal-buffer';

export interface CopyContent {
  readonly slice: Slice;
  readonly mode: ClipboardMode;
}

export function buildCopySlice(state: EditorState, registry: BlockRegistry): CopyContent | null {
  const blockSelection = getBlockSelection(state);
  if (blockSelection.selected.size > 0) {
    const nodes: PMNode[] = [];
    for (const range of coveredBlockRanges(state.doc, registry, blockSelection.selected)) {
      const node = state.doc.nodeAt(range.from);
      if (node) nodes.push(node);
    }
    if (nodes.length === 0) return null;
    // Whole blocks, so the slice is closed at both ends; placement on paste
    // treats them as siblings rather than fitting them into open depth.
    return { slice: new Slice(Fragment.fromArray(nodes), 0, 0), mode: 'blocks' };
  }

  if (state.selection.empty) return null;
  const content = state.selection.content();
  if (content.size === 0) return null;
  return { slice: content, mode: 'text' };
}
