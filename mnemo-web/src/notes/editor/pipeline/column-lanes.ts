/**
 * Marks the lanes of the two-column layout holding the caret, so CSS can draw them as dashed
 * slots. Hover draws the same slots from CSS alone. Decorations only.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/** Position before the innermost layout holding `pos`, or null outside one. */
export function layoutAround(doc: PMNode, pos: number): number | null {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'twoColumn') return $pos.before(depth);
  }
  return null;
}

function decorate(state: EditorState): DecorationSet | null {
  const at = layoutAround(state.doc, state.selection.head);
  const layout = at === null ? null : state.doc.nodeAt(at);
  if (at === null || !layout) return null;
  const decorations: Decoration[] = [];
  layout.forEach((cell, offset) => {
    if (cell.type.name !== 'columnGroup') return;
    const from = at + 1 + offset;
    decorations.push(Decoration.node(from, from + cell.nodeSize, { class: 'notes-column-active' }));
  });
  return DecorationSet.create(state.doc, decorations);
}

export function columnLanesPlugin(): Plugin {
  return new Plugin({ props: { decorations: decorate } });
}
