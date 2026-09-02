/**
 * Numbered-list numbering, as decorations rather than stored data.
 *
 * A numbered item's displayed number is never persisted, the list schema keeps
 * `data-numbered` items as siblings with no index attr, because a stored number
 * goes stale the instant a block is inserted above it. So the number is
 * recomputed from document order on every change and painted through a
 * `data-list-number` attribute the stylesheet renders.
 *
 * The rules:
 *
 *  - A run of consecutive numbered items counts 1, 2, 3; every run restarts at
 *    1 (there is no stored start, so a `5. ` shortcut still starts wherever its
 *    position dictates, the documented number-not-stored divergence).
 *
 *  - **Any** non-numbered block resets the run. A paragraph, a heading, a bullet
 *    between two numbered items breaks the sequence.
 *
 *  - A nested list is a run of its own. An item's block children start at 1
 *    whatever their parent's number is, and the parent's run carries on past
 *    them: 1, then a and b beneath it, then 2. The label style follows the
 *    nesting depth the way every outliner's does: decimal, then lower-case
 *    letters, then lower-case roman, repeating from there.
 *
 *  - A two-column block is transparent. Its cells' blocks continue the run they
 *    sit in, **left column top to bottom, then right**, and neither the container
 *    nor the boundary between its columns resets it, so a run flows straight
 *    through a two-column and out the other side. That holds at any depth.
 *
 * The whole set is recomputed per document change. That is O(blocks), the walk
 * never enters a line's inline content; a range-local recompute (map the old
 * set, rebuild only the runs a change touched) is the optimization the
 * typing-at-size work will decide is worth its complexity.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { isListItem } from '../blocks/shared';

const listNumberKey = new PluginKey<DecorationSet>('notes-list-numbers');

/** The state of one run of numbered items: what the next one is called, and whether the last block was one. */
interface Run {
  next: number;
  prevNumbered: boolean;
}

function freshRun(): Run {
  return { next: 1, prevNumbered: false };
}

/** Bijective base 26: a, b, ... z, aa, ab, the way spreadsheet columns count. */
function alphaLabel(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

/** Lower-case roman numerals; past their conventional range the decimal is more legible. */
function romanLabel(index: number): string {
  if (index >= 4000) return String(index);
  let n = index;
  let out = '';
  for (const [value, glyph] of ROMAN) {
    while (n >= value) {
      out += glyph;
      n -= value;
    }
  }
  return out;
}

/**
 * The label for the `index`-th item of a run `depth` list levels down: `1`,
 * then `a`, then `i`, cycling. The stylesheet appends the period.
 */
export function listLabel(index: number, depth: number): string {
  switch (depth % 3) {
    case 1:
      return alphaLabel(index);
    case 2:
      return romanLabel(index);
    default:
      return String(index);
  }
}

/** The container types whose children continue the enclosing run rather than starting one. */
const transparentNames: ReadonlySet<string> = new Set(['twoColumn', 'columnGroup']);

/**
 * The node decorations that number every numbered item in `doc`. Pure and
 * view-free, so the numbering is testable without mounting anything.
 */
export function listNumberDecorations(doc: PMNode): Decoration[] {
  const decos: Decoration[] = [];

  // `contentStart` is the position of the parent's first child.
  const walk = (parent: PMNode, contentStart: number, depth: number, run: Run): void => {
    let offset = contentStart;
    parent.forEach((child) => {
      const pos = offset;
      offset += child.nodeSize;
      // A line holds inline content, never a block: it neither counts nor resets.
      if (child.isTextblock || child.isText) return;

      if (transparentNames.has(child.type.name)) {
        walk(child, pos + 1, depth, run);
        return;
      }

      if (child.type.name === 'numberedItem') {
        if (!run.prevNumbered) run.next = 1;
        decos.push(
          Decoration.node(pos, pos + child.nodeSize, { 'data-list-number': listLabel(run.next, depth) }),
        );
        run.next += 1;
        run.prevNumbered = true;
        walk(child, pos + 1, depth + 1, freshRun());
        return;
      }

      // Every other block breaks the run. Its own children, if it has any, are
      // a run of their own, one level deeper when the block is a list item.
      run.next = 1;
      run.prevNumbered = false;
      walk(child, pos + 1, isListItem(child) ? depth + 1 : depth, freshRun());
    });
  };

  walk(doc, 0, 0, freshRun());
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
