/**
 * A caret between blocks, for the boundaries that have none.
 *
 * A block that draws itself entirely from its payload (a divider, a block
 * equation, a page card) renders no editable content for the line the schema
 * makes it carry, so the position inside that line has no DOM to sit at. When
 * one of them starts a note, or two of them sit next to each other, the boundary
 * beside it holds no caret at all: no arrow key reaches it, no click lands on
 * it, and nothing can be typed above the block.
 *
 * This is ProseMirror's gap cursor, written here rather than taken from
 * `prosemirror-gapcursor`, because that package decides where a gap belongs by
 * asking whether the neighbouring node is closed and whether the parent's
 * default child is a textblock. Here every block wraps a `line` and no block is
 * itself a textblock, so both halves of that rule answer wrongly at every
 * position in the document and both would have to be overridden away.
 *
 * The rule below is the editor's own: a gap belongs where a paragraph could be
 * typed, where one neighbour is a block the caret cannot enter, and where the
 * other neighbour offers no caret either. Anywhere else the neighbouring line's
 * own start or end already is the caret at that boundary, and a second one there
 * would only be somewhere the caret disappears into.
 */

import { Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model';
import { Selection, type SelectionBookmark } from 'prosemirror-state';
import type { Mappable } from 'prosemirror-transform';

import { containerBlockNames, lineIsCaretTarget } from '../editor/blocks/shared';

/** The selection type name, as the JSON round trip and the history bookmark use it. */
const GAP_CURSOR_ID = 'gapCursor';

/**
 * Whether the caret can land anywhere inside this node, at any depth.
 *
 * Asked of the whole subtree rather than of the node's own line, because a table
 * and a two-column hold no caret in their line either while their cells hold
 * plenty. The blocks this module exists for have nothing inside at all: the
 * mandatory line is everything they carry and their view draws no DOM for it.
 */
export function holdsAnyCaret(node: PMNode): boolean {
  if (lineIsCaretTarget(node.type)) return true;
  let found = false;
  // A caret-less owner's own line is scenery, so only its block children can
  // supply one.
  node.forEach((child) => {
    if (!found && !child.isTextblock && holdsAnyCaret(child)) found = true;
  });
  return found;
}

/**
 * Whether the neighbour on one side of a boundary already puts a caret there.
 *
 * A block answers for its whole subtree. A line answers for its owner: the
 * mandatory line of a block that holds no caret is hidden scenery, so a divider
 * at the head of a column cell has nothing above it even though the cell's line
 * is the node before.
 */
function offersCaret(parent: PMNode, node: PMNode | null): boolean {
  if (node === null) return false;
  if (node.isTextblock) return lineIsCaretTarget(parent.type);
  return holdsAnyCaret(node);
}

/**
 * Whether blocks a reader put there live directly inside this node.
 *
 * A container holds a cell's flow and a caret-holding block holds its nested
 * list. A block that draws itself from its payload holds neither: the line it
 * carries is the schema's uniformity and nothing has ever been put after it, so
 * a caret inside one would be a caret inside a divider.
 */
function holdsBlockFlow(parent: PMNode): boolean {
  return lineIsCaretTarget(parent.type) || containerBlockNames.has(parent.type.name);
}

/** Whether a gap cursor belongs at this position. */
export function gapCursorValid($pos: ResolvedPos): boolean {
  const parent = $pos.parent;
  if (parent.isTextblock || !holdsBlockFlow(parent)) return false;

  const paragraph = parent.type.schema.nodes.paragraph;
  // A gap stands for the paragraph typing there would create, so it only exists
  // where the parent would accept one. That rules out a table's rows, a row's
  // cells and a split's columns, which are their parent's own structure, and the
  // slot before a block's mandatory line, which belongs to the line.
  if (!paragraph || !parent.contentMatchAt($pos.index()).matchType(paragraph)) return false;

  const before = $pos.nodeBefore;
  const after = $pos.nodeAfter;
  if (offersCaret(parent, before) || offersCaret(parent, after)) return false;
  return before !== null || after !== null;
}

/**
 * The nearest gap position from `$start` in `dir`, or null when there is none.
 *
 * The walk steps over blocks the caret cannot enter and climbs out of a parent it
 * runs off the end of. Meeting a block that does hold a caret ends it: that
 * block's own line is where the key was going, and carrying on to a gap beyond it
 * would step over content.
 *
 * `mustMove` skips the starting position, which is what an arrow pressed at a gap
 * needs so it leaves the one it is already on.
 */
export function findGapFrom(
  $start: ResolvedPos,
  dir: 1 | -1,
  mustMove: boolean,
): ResolvedPos | null {
  const doc = $start.node(0);
  let pos = $start.pos;
  let skip = mustMove;
  // Each turn either steps past a node or climbs a level, both monotone in
  // `dir`, so the document's own size bounds the walk.
  for (let guard = 0; guard <= doc.nodeSize; guard++) {
    const $pos = doc.resolve(pos);
    if (!skip && gapCursorValid($pos)) return $pos;
    skip = false;

    const next = dir > 0 ? $pos.nodeAfter : $pos.nodeBefore;
    if (next) {
      if (holdsAnyCaret(next)) return null;
      pos += dir * next.nodeSize;
      continue;
    }
    if ($pos.depth === 0) return null;
    pos = dir > 0 ? $pos.after($pos.depth) : $pos.before($pos.depth);
  }
  return null;
}

/** Where a search leaving the block that holds `$caret` starts, going `dir`. */
export function gapSearchStart($caret: ResolvedPos, dir: 1 | -1): ResolvedPos {
  const doc = $caret.node(0);
  return doc.resolve(dir > 0 ? $caret.after($caret.depth) : $caret.before($caret.depth));
}

/** Survives a remap without a document, so undo and redo restore a gap as a gap. */
class GapBookmark implements SelectionBookmark {
  private readonly pos: number;

  constructor(pos: number) {
    this.pos = pos;
  }

  map(mapping: Mappable): GapBookmark {
    return new GapBookmark(mapping.map(this.pos));
  }

  resolve(doc: PMNode): Selection {
    const $pos = doc.resolve(this.pos);
    return gapCursorValid($pos) ? new GapCursor($pos) : Selection.near($pos);
  }
}

/**
 * The selection itself: empty, and invisible to the browser.
 *
 * Nothing in the DOM sits where it points, so ProseMirror is told to hide the
 * native selection (`visible`) and the plugin paints the caret as a widget
 * decoration instead.
 */
export class GapCursor extends Selection {
  constructor($pos: ResolvedPos) {
    super($pos, $pos);
  }

  map(doc: PMNode, mapping: Mappable): Selection {
    const $pos = doc.resolve(mapping.map(this.head));
    return gapCursorValid($pos) ? new GapCursor($pos) : Selection.near($pos);
  }

  content(): Slice {
    return Slice.empty;
  }

  eq(other: Selection): boolean {
    return other instanceof GapCursor && other.head === this.head;
  }

  toJSON(): { type: string; pos: number } {
    return { type: GAP_CURSOR_ID, pos: this.head };
  }

  getBookmark(): SelectionBookmark {
    return new GapBookmark(this.anchor);
  }

  static fromJSON(doc: PMNode, json: { pos?: unknown }): GapCursor {
    if (typeof json.pos !== 'number') throw new RangeError('Invalid input for GapCursor.fromJSON');
    return new GapCursor(doc.resolve(json.pos));
  }
}

GapCursor.prototype.visible = false;

// Registered because three paths round-trip the live selection through JSON (the
// paste placer, the identity plugin and the transient focus scope), and an
// unregistered type throws there rather than coming back.
Selection.jsonID(GAP_CURSOR_ID, GapCursor);
