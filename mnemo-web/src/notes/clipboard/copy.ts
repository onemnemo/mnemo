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
 * on copy, so the payload can still say which blocks it came from. The first
 * numbered item of each run in the slice carries the number it shows as its
 * start, so the markdown copy and a paste back both keep the numbers seen.
 */

import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

import type { BlockRegistry } from '../editor/registry/build';
import { LIST_START_KEY, storedListStart, withListStart } from '../editor/blocks/list-start';
import { forEachNumbered } from '../editor/pipeline/list-numbers';
import { getBlockSelection } from '../selection/block-selection-plugin';
import { coveredBlockRanges } from '../selection/delete-selected';
import type { ClipboardMode } from './internal-buffer';

export interface CopyContent {
  readonly slice: Slice;
  readonly mode: ClipboardMode;
}

interface Placed {
  readonly node: PMNode;
  readonly pos: number;
}

type Shown = () => ReadonlyMap<number, number>;

function shownNumbers(doc: PMNode): Shown {
  let shown: Map<number, number> | null = null;
  return () => {
    if (!shown) {
      const numbers = new Map<number, number>();
      forEachNumbered(doc, (_node, pos, _index, number) => numbers.set(pos, number));
      shown = numbers;
    }
    return shown;
  };
}

/**
 * The blocks with the first numbered item of each run stamped. An item whose
 * shown number does not count on from the item before it opens a run of its
 * own, and stores its number even when that is 1.
 */
function stampRuns(placed: readonly Placed[], shown: Shown): PMNode[] {
  let previous: number | null = null;
  return placed.map(({ node, pos }) => {
    if (node.type.name !== 'numberedItem') {
      previous = null;
      return node;
    }
    const number = shown().get(pos) ?? null;
    const follows = previous !== null && number === previous + 1;
    const splits = previous !== null && !follows;
    previous = number;
    let meta = withListStart(node.attrs.meta, follows ? null : number);
    if (splits && number !== null) meta = { ...meta, [LIST_START_KEY]: number };
    if (storedListStart(meta) === storedListStart(node.attrs.meta)) return node;
    return node.type.create({ ...node.attrs, meta }, node.content, node.marks);
  });
}

/**
 * `fragment`, a piece of `parent`'s content from child `first` on, stamped at
 * every depth. While `open` is above 0 its first block is cut at the front, so
 * that block's content starts where the selection does.
 */
function stampFragment(
  fragment: Fragment,
  parent: PMNode,
  contentStart: number,
  first: number,
  $from: ResolvedPos,
  open: number,
  shown: Shown,
): Fragment {
  let pos = contentStart;
  for (let i = 0; i < first; i++) pos += parent.child(i).nodeSize;
  const placed: Placed[] = [];
  fragment.forEach((node, _offset, k) => {
    const original = parent.child(first + k);
    let stamped = node;
    if (!node.isTextblock && !node.isLeaf && node.childCount > 0) {
      const cut = k === 0 && open > 0;
      const inner = cut ? $from.index($from.depth - open + 1) : 0;
      stamped = node.copy(stampFragment(node.content, original, pos + 1, inner, $from, cut ? open - 1 : 0, shown));
    }
    placed.push({ node: stamped, pos });
    pos += original.nodeSize;
  });
  return Fragment.fromArray(stampRuns(placed, shown));
}

export function buildCopySlice(state: EditorState, registry: BlockRegistry): CopyContent | null {
  const shown = shownNumbers(state.doc);
  const blockSelection = getBlockSelection(state);
  if (blockSelection.selected.size > 0) {
    const placed: Placed[] = [];
    for (const range of coveredBlockRanges(state.doc, registry, blockSelection.selected)) {
      const node = state.doc.nodeAt(range.from);
      if (!node) continue;
      // A whole column row carries its numbered items inside it, and they need their numbers too.
      const inner = node.isTextblock || node.isLeaf || node.childCount === 0
        ? node
        : node.copy(stampFragment(node.content, node, range.from + 1, 0, state.selection.$from, 0, shown));
      placed.push({ node: inner, pos: range.from });
    }
    if (placed.length === 0) return null;
    // Whole blocks, so the slice is closed at both ends; placement on paste
    // treats them as siblings rather than fitting them into open depth.
    return { slice: new Slice(Fragment.fromArray(stampRuns(placed, shown)), 0, 0), mode: 'blocks' };
  }

  if (state.selection.empty) return null;
  const content = state.selection.content();
  if (content.size === 0) return null;
  // `content()` keeps the selection's ancestors, so its top level is the document's.
  const $from = state.selection.$from;
  const stamped = stampFragment(content.content, state.doc, 0, $from.index(0), $from, content.openStart, shown);
  return { slice: new Slice(stamped, content.openStart, content.openEnd), mode: 'text' };
}
