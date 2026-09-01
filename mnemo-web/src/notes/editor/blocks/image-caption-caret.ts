/**
 * Reveals a hidden image caption while the caret is in it.
 *
 * An empty caption is clipped rather than removed, so arrowing down from the picture still lands
 * in it, and a caret in a line of zero height with no ink is a caret nobody can find. The view
 * that draws the caption cannot see this on its own: ProseMirror only calls a NodeView's `update`
 * when the document or its decorations changed, and moving the caret changes neither.
 *
 * So the caret becomes a decoration. It rides on the image node, which puts the class on the
 * figure the view already owns, and changing it is what makes ProseMirror redraw at all.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** On the figure while the caret is inside that image's caption. */
export const CAPTION_CARET_CLASS = 'notes-image-caption-caret';

/**
 * The image whose caption holds the selection, decorated. Pure, so which selections count is
 * testable without mounting a view.
 */
export function imageCaptionCaretDecorations(state: EditorState): Decoration[] {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== 'image') continue;
    const pos = $from.before(depth);
    return [Decoration.node(pos, pos + node.nodeSize, { class: CAPTION_CARET_CLASS })];
  }
  return [];
}

/** The plugin's state: the decorated figure's position (null for none), and the set built from it. */
interface CaptionCaretState {
  readonly pos: number | null;
  readonly set: DecorationSet;
}

function computeCaptionCaretState(state: EditorState): CaptionCaretState {
  const decorations = imageCaptionCaretDecorations(state);
  return {
    pos: decorations.length > 0 ? decorations[0].from : null,
    set: DecorationSet.create(state.doc, decorations),
  };
}

const captionCaretKey = new PluginKey<CaptionCaretState>('notes-image-caption-caret');

/** The plugin's current decoration set. Exported for a test that asserts on its identity. */
export function captionCaretDecorationSet(state: EditorState): DecorationSet | undefined {
  return captionCaretKey.getState(state)?.set;
}

/**
 * Decoration only, so it appends no step and never dirties the note. Typing inside a caption
 * fires `apply` on every keystroke (the transaction changes the document and moves the caret
 * within it), so recomputing here is not the rare case its position in the plugin list suggests:
 * it is once per keystroke, over every top-level block, for a caret that never left the same
 * figure. Rebuilding is skipped whenever the decorated figure's own position has not moved, which
 * is what makes a run of typing cost one rebuild rather than one per character.
 */
export function imageCaptionCaretPlugin(): Plugin<CaptionCaretState> {
  return new Plugin<CaptionCaretState>({
    key: captionCaretKey,
    state: {
      init: (_config, state) => computeCaptionCaretState(state),
      apply(tr, old, oldState, newState) {
        if (!tr.docChanged && oldState.selection.eq(newState.selection)) return old;
        const next = computeCaptionCaretState(newState);
        return next.pos === old.pos ? old : next;
      },
    },
    props: {
      decorations(this: Plugin<CaptionCaretState>, state: EditorState) {
        return this.getState(state)?.set;
      },
    },
  });
}
