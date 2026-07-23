/**
 * The block action menu's commands: the verbs the gutter handle offers on one
 * top-level block. Each is a pure builder returning the single transaction it
 * would dispatch, or null when it does not apply, so the menu is a projection of
 * these and they are testable without a view.
 *
 * Every verb is one transaction, so every action is one undo and one save, the
 * same invariant the drag reorder holds.
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
import { moveBlockTransaction } from './block-move';

export interface BlockLocation {
  readonly index: number;
  readonly pos: number;
  readonly node: PMNode;
}

/** Locate a top-level block by its document-child index, or null if out of range. */
export function locateBlock(state: EditorState, index: number): BlockLocation | null {
  const doc = state.doc;
  if (index < 0 || index >= doc.childCount) return null;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return { index, pos, node: doc.child(index) };
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

export function moveBlockUp(state: EditorState, index: number): Transaction | null {
  if (index <= 0) return null;
  return moveBlockTransaction(state, index, index - 1);
}

export function moveBlockDown(state: EditorState, index: number): Transaction | null {
  if (index >= state.doc.childCount - 1) return null;
  return moveBlockTransaction(state, index, index + 1);
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

/** Remove the block, unless it is the only one: the document may never be emptied. */
export function deleteBlock(state: EditorState, loc: BlockLocation): Transaction | null {
  if (state.doc.childCount <= 1) return null;
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
