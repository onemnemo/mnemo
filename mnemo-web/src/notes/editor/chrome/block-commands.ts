/**
 * The block action menu's commands: the verbs the gutter handle offers on one
 * block. Each is a pure builder returning the single transaction it would
 * dispatch, or null when it does not apply, so the menu is a projection of
 * these and they are testable without a view.
 *
 * Every verb is one transaction, so every action is one undo and one save, the
 * same invariant the drag reorder holds.
 *
 * The unit is the located block at any depth, not a document-child index: the
 * gutter follows the deepest hovered block, so inside a two-column row these
 * verbs act on the hovered cell child, and "up"/"down" mean its own sibling
 * run within that cell. Deleting the last block of a cell is allowed; the
 * column-repair invariant reseeds the cell in the same undo step.
 *
 * The desktop editor has no such menu - it reorders by drag-handle only and
 * deletes/duplicates through three per-block flyouts - so this is a deliberate
 * step toward the Notion-style block menu the plan calls for, not a 1:1 port.
 * Labels are English literals for now; the shared bundle has no keys for a menu
 * that did not exist, and new Notes strings in this port are localized later.
 */

import type { EditorState, Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { convertBlockType } from '../commands/structure';
import type { BlockRegistry } from '../registry/build';
import { walkBlocks } from '../projection/document';

export interface SiblingRef {
  readonly pos: number;
  readonly node: PMNode;
}

export interface BlockLocation {
  /** Position just before the block node. */
  readonly pos: number;
  readonly node: PMNode;
  /** Position of the parent node, or -1 when the parent is the document. */
  readonly parentPos: number;
  readonly parent: PMNode;
  /** Previous/next *block* sibling within the parent; the mandatory line is skipped. */
  readonly prev: SiblingRef | null;
  readonly next: SiblingRef | null;
}

/**
 * Locate a block for a command, resilient to the document having moved on.
 *
 * The fast path trusts `pos`: the node still sitting there with the expected
 * sid is the block the menu was opened on (menu interactions dispatch nothing,
 * so this is the common case). If the document changed underneath - an
 * invariant repair, a concurrent edit - the block is re-found by sid, the one
 * identifier that survives any reshuffle. A block that lost both is gone.
 */
export function locateBlock(
  state: EditorState,
  registry: BlockRegistry,
  pos: number,
  sid: string,
): BlockLocation | null {
  const doc = state.doc;

  let at: { pos: number; node: PMNode } | null = null;
  const direct = pos >= 0 && pos <= doc.content.size ? doc.nodeAt(pos) : null;
  if (direct && registry.byNodeName.has(direct.type.name) && (sid === '' || String(direct.attrs.sid) === sid)) {
    at = { pos, node: direct };
  } else if (sid !== '') {
    const entry = walkBlocks(doc, registry).find((candidate) => candidate.sid === sid);
    if (entry) at = { pos: entry.pos, node: entry.node };
  }
  if (!at) return null;
  const located = at;

  const $pos = doc.resolve(located.pos);
  const parent = $pos.depth === 0 ? doc : $pos.node($pos.depth);
  const parentPos = $pos.depth === 0 ? -1 : $pos.before($pos.depth);

  let prev: SiblingRef | null = null;
  let next: SiblingRef | null = null;
  let offset = parentPos + 1;
  parent.forEach((child) => {
    const childPos = offset;
    offset += child.nodeSize;
    if (!registry.byNodeName.has(child.type.name)) return;
    if (childPos < located.pos) prev = { pos: childPos, node: child };
    else if (childPos > located.pos && next === null) next = { pos: childPos, node: child };
  });

  return { pos: located.pos, node: located.node, parentPos, parent, prev, next };
}

/** Text-bearing blocks that can be turned into one another. Atomic blocks cannot. */
const CONVERTIBLE = new Set([
  'paragraph',
  'heading',
  'quote',
  'bulletItem',
  'numberedItem',
  'checklistItem',
  'codeBlock',
]);

export function canTurnInto(node: PMNode): boolean {
  return CONVERTIBLE.has(node.type.name);
}

export interface TurnIntoOption {
  readonly id: string;
  readonly label: string;
  readonly nodeName: string;
  readonly attrs?: Record<string, unknown>;
}

/** The types "Turn into" offers, in menu order. */
export const TURN_INTO_OPTIONS: readonly TurnIntoOption[] = [
  { id: 'text', label: 'Text', nodeName: 'paragraph' },
  { id: 'heading1', label: 'Heading 1', nodeName: 'heading', attrs: { level: 1 } },
  { id: 'heading2', label: 'Heading 2', nodeName: 'heading', attrs: { level: 2 } },
  { id: 'heading3', label: 'Heading 3', nodeName: 'heading', attrs: { level: 3 } },
  { id: 'bullet', label: 'Bulleted list', nodeName: 'bulletItem' },
  { id: 'numbered', label: 'Numbered list', nodeName: 'numberedItem' },
  { id: 'checklist', label: 'Checklist', nodeName: 'checklistItem' },
  { id: 'quote', label: 'Quote', nodeName: 'quote' },
  { id: 'code', label: 'Code', nodeName: 'codeBlock' },
];

/** Whether an option is the block's current type, so the menu can mark it and skip a no-op. */
export function isCurrentType(node: PMNode, option: TurnIntoOption): boolean {
  if (node.type.name !== option.nodeName) return false;
  const level = option.attrs?.level;
  return level == null || node.attrs.level === level;
}

/**
 * Swap the block with its previous sibling, or null at the top of its run.
 *
 * The sibling precedes the deleted range, so its position needs no mapping.
 */
export function moveBlockUp(state: EditorState, loc: BlockLocation): Transaction | null {
  if (!loc.prev) return null;
  const tr = state.tr.delete(loc.pos, loc.pos + loc.node.nodeSize);
  return tr.insert(loc.prev.pos, loc.node);
}

/**
 * Swap the block with its next sibling, or null at the bottom of its run.
 *
 * After the deletion the sibling has shifted up by the removed size; the block
 * re-inserts just past it.
 */
export function moveBlockDown(state: EditorState, loc: BlockLocation): Transaction | null {
  if (!loc.next) return null;
  const tr = state.tr.delete(loc.pos, loc.pos + loc.node.nodeSize);
  return tr.insert(loc.next.pos - loc.node.nodeSize + loc.next.node.nodeSize, loc.node);
}

/**
 * A rebuild of a node with the block identifiers cleared on it and on every block
 * nested inside it, so the identity plugin mints fresh ones for all of them.
 *
 * Clearing only the top node is not enough for a container: a two-column block
 * carries whole blocks in its cells, and reusing their content verbatim would
 * copy their sids too, leaving two blocks that share one sid, the id the AI quotes
 * and the one identifier the note format guarantees is unique. Inline nodes and
 * the base line nodes have no identity attrs, so they pass through untouched.
 */
function withFreshIdentity(node: PMNode): PMNode {
  // Text nodes carry no identity and cannot be rebuilt through type.create.
  if (node.isText) return node;
  const carriesIdentity = 'sid' in node.attrs && 'id' in node.attrs;
  const attrs = carriesIdentity ? { ...node.attrs, id: '', sid: '' } : node.attrs;
  if (node.content.childCount === 0) return node.type.create(attrs, null, node.marks);
  const children: PMNode[] = [];
  node.content.forEach((child) => children.push(withFreshIdentity(child)));
  return node.type.create(attrs, children, node.marks);
}

/**
 * A copy of the block right after it, with every block identifier cleared so the
 * identity plugin mints new ones: two blocks must never share a sid.
 */
export function duplicateBlock(state: EditorState, loc: BlockLocation): Transaction {
  const { pos, node } = loc;
  return state.tr.insert(pos + node.nodeSize, withFreshIdentity(node));
}

/**
 * Remove the block. Refused only for the document's last top-level block - the
 * document may never be emptied. A cell's last block deletes fine; the
 * column-repair invariant reseeds the cell in the same undo step.
 */
export function deleteBlock(state: EditorState, loc: BlockLocation): Transaction | null {
  if (loc.parentPos < 0 && state.doc.childCount <= 1) return null;
  const { pos, node } = loc;
  return state.tr.delete(pos, pos + node.nodeSize);
}

/** Convert the block to another text type, or null for an unknown type or a no-op. */
export function turnInto(state: EditorState, loc: BlockLocation, option: TurnIntoOption): Transaction | null {
  const type = state.schema.nodes[option.nodeName];
  if (!type) return null;
  if (isCurrentType(loc.node, option)) return null;
  return convertBlockType(state.tr, loc.pos, loc.node, type, { attrs: option.attrs });
}
