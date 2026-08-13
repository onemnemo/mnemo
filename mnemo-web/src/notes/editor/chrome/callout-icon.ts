/**
 * Changing a callout's glyph after it has been inserted.
 *
 * Three surfaces raise the same picker, the glyph itself and the block menu's
 * row in each of its two renderings. This is the verb behind all of them, kept
 * out of the React so a surface owns a picker and nothing else, the same split
 * the block menu's verbs use.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { asOwnUndoStep } from '../history';
import type { BlockRegistry } from '../registry/build';
import { locateBlock } from './block-commands';

/** Whether the block is the one this verb applies to. */
export function isCalloutNode(node: PMNode): boolean {
  return node.type.name === 'callout';
}

/**
 * Write `emoji` onto the callout at `target`, and report whether anything was
 * dispatched.
 *
 * The block is re-located first: the gutter's snapshot position can predate an
 * invariant repair, and a markup change at a stale position would rewrite
 * whatever block sits there now. Every other attr is carried across, so the tone
 * and the block's identity survive the change.
 *
 * An empty string is a value, not a refusal, it renders a callout with no glyph.
 * Re-picking the glyph already set is the refusal: it would be an undo entry that
 * changes nothing.
 */
export function setCalloutEmoji(
  view: EditorView,
  registry: BlockRegistry,
  target: { pos: number; sid: string },
  emoji: string,
): boolean {
  const loc = locateBlock(view.state, registry, target.pos, target.sid);
  if (!loc || !isCalloutNode(loc.node)) return false;
  if (String(loc.node.attrs.emoji ?? '') === emoji) return false;
  view.dispatch(
    asOwnUndoStep(view.state.tr.setNodeMarkup(loc.pos, undefined, { ...loc.node.attrs, emoji })),
  );
  return true;
}
