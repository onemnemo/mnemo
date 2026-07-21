/**
 * Numbered-list numbering, as decorations rather than stored data.
 *
 * A numbered item's displayed number is never persisted — the frozen list schema
 * keeps `data-numbered` items as flat siblings with no index attr, because a
 * stored number goes stale the instant a block is inserted above it. So the
 * number is recomputed from document order on every change and painted through a
 * `data-list-number` attribute the stylesheet renders.
 *
 * The rule ports the desktop's `UpdateListNumbers` walking `EnumerateInDocument`
 * order exactly:
 *
 *  - A run of consecutive numbered items counts 1, 2, 3…; every run restarts at 1
 *    (the desktop seeded from a stored index, but the port stores none, so a
 *    `5. ` shortcut still starts wherever its position dictates — the documented
 *    number-not-stored divergence).
 *
 *  - **Any** non-numbered block resets the run. A paragraph, a heading, a bullet
 *    between two numbered items breaks the sequence.
 *
 *  - A two-column block is flattened **left column top-to-bottom, then right** —
 *    and neither the container nor the boundary between its columns resets the
 *    run. The desktop's enumerator never yields the container itself, only its
 *    cells' contents, so a run flows straight through a two-column and out the
 *    other side. Only top-level two-columns flatten; a nested one is treated as a
 *    single (non-numbered) block, matching the enumerator's single level of
 *    descent.
 *
 * The whole set is recomputed per document change. That is O(document), the same
 * as the desktop pass; a range-local recompute (map the old set, rebuild only the
 * runs a change touched) is the optimization the typing-at-size work will
 * decide is worth its complexity.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

const listNumberKey = new PluginKey<DecorationSet>('notes-list-numbers');

/**
 * The node decorations that number every numbered item in `doc`. Pure and
 * view-free, so the numbering is testable without mounting anything.
 */
export function listNumberDecorations(doc: PMNode): Decoration[] {
  const decos: Decoration[] = [];
  let next = 1;
  let prevNumbered = false;

  const visit = (node: PMNode, pos: number): void => {
    if (node.type.name === 'numberedItem') {
      if (!prevNumbered) next = 1;
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-list-number': String(next) }));
      next += 1;
      prevNumbered = true;
      return;
    }
    // Every other block breaks the run.
    next = 1;
    prevNumbered = false;
  };

  doc.forEach((block, offset) => {
    if (block.type.name === 'twoColumn') {
      // Flatten the two cells in order without resetting for the container or the
      // column boundary — only the cells' own contents advance the run.
      block.forEach((cellGroup, groupOffset) => {
        if (cellGroup.type.name !== 'columnGroup') return; // skip the container's line
        const groupPos = offset + 1 + groupOffset;
        cellGroup.forEach((cell, cellOffset) => {
          // Skip the cell's mandatory line; visit its block contents.
          if (cell.type.name === 'line' || cell.type.name === 'codeLine') return;
          visit(cell, groupPos + 1 + cellOffset);
        });
      });
      return;
    }
    visit(block, offset);
  });

  return decos;
}

/**
 * The plugin. Holds the current `DecorationSet` in its state and rebuilds it on
 * any document change, exposing it through `props.decorations` so both the
 * read-only and the editable view paint the same numbers.
 */
export function numberedListPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: listNumberKey,
    state: {
      init: (_config, state) =>
        DecorationSet.create(state.doc, listNumberDecorations(state.doc)),
      apply(tr, old, _oldState, newState) {
        if (!tr.docChanged) return old;
        return DecorationSet.create(newState.doc, listNumberDecorations(newState.doc));
      },
    },
    props: {
      decorations(this: Plugin<DecorationSet>, state: EditorState) {
        return this.getState(state);
      },
    },
  });
}
