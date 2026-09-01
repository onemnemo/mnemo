/**
 * How a block's own body starts the gutter's drag.
 *
 * A press on an image is a press on the block, and it has to raise the same drag the grip does:
 * the same ghost, the same drop line, the same auto-scroll, the same swallowed trailing click.
 * None of that lives in a NodeView and none of it can, so the direction is inverted. The gutter
 * registers what it can already do, and a NodeView asks for it with the two facts it holds, the
 * press and its own position.
 *
 * The press is described structurally rather than as a React event so a native listener can hand
 * over the event it was given, and the registration is keyed by view so two panes showing the
 * same note never reach each other's drag.
 */

import type { EditorView } from 'prosemirror-view';

import type { DragPress } from '@/lib/dnd/usePointerDrag';

export type BlockDragPress = (event: DragPress, pos: number) => void;

const presses = new Map<EditorView, BlockDragPress>();

/**
 * Offers this view's block drag to any NodeView inside it. Returns the removal.
 *
 * The removal is identity checked: StrictMode runs an effect's cleanup and then the effect again,
 * and a bare delete would take out the registration the second run had just made.
 */
export function registerBlockDragPress(view: EditorView, press: BlockDragPress): () => void {
  presses.set(view, press);
  return () => {
    if (presses.get(view) === press) presses.delete(view);
  };
}

/**
 * Starts the block drag for the block at `pos`. False when nothing is registered, which is every
 * surface without a gutter (a read-only note, a preview) and is not a fault: the press was still
 * handled as a selection.
 */
export function pressBlockDrag(view: EditorView, event: DragPress, pos: number): boolean {
  const press = presses.get(view);
  if (!press) return false;
  press(event, pos);
  return true;
}
