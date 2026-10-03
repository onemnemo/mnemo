/**
 * Numbered-list numbering, as decorations rather than stored data.
 *
 * Only a run's start is stored, on its first item (see `blocks/list-start.ts`).
 * Every other number is recomputed from document order and painted through a
 * `data-list-number` attribute the stylesheet renders, because a stored number
 * goes stale the instant a block is inserted above it.
 *
 * The rules:
 *
 *  - A run of consecutive numbered items counts up from its first item's start,
 *    1 when that item stores none: 8, 9, 10.
 *
 *  - **Any** non-numbered block resets the run. A paragraph, a heading, a bullet
 *    between two numbered items breaks the sequence.
 *
 *  - A nested list is a run of its own, with its own start, and the parent's run
 *    carries on past it: 1, then a and b beneath it, then 2. The label style
 *    follows the nesting depth the way every outliner's does: decimal, then
 *    lower-case letters, then lower-case roman, repeating from there.
 *
 *  - A two-column block is transparent. Its cells' blocks continue the run they
 *    sit in, **left column top to bottom, then right**, and neither the container
 *    nor the boundary between its columns resets it, so a run flows straight
 *    through a two-column and out the other side. That holds at any depth.
 *
 * A structural change rebuilds the set in one O(blocks) walk that never enters a
 * line's inline content. Typing cannot change a number, so it only maps the set.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { isListItem } from '../blocks/shared';
import { listStartOf, storedListStart } from '../blocks/list-start';
import { onlyEditsText } from './text-only-steps';

/** The numbering of one document. */
export interface ListNumbering {
  readonly decorations: DecorationSet;
  /** Whether any numbered item stores a start, the only case edits have a start to keep. */
  readonly anyStart: boolean;
}

export const listNumberKey = new PluginKey<ListNumbering>('notes-list-numbers');

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
 * Called for every numbered item in document order: its place in its run (0 for
 * the first), the number it shows, the list depth its label is drawn at, and an
 * id every item of its run shares.
 */
export type NumberedVisitor = (
  node: PMNode,
  pos: number,
  index: number,
  number: number,
  depth: number,
  run: number,
) => void;

/** The run a walk is in: its id, the place of its last item, and the number it opened at. */
interface Run {
  id: number;
  index: number;
  start: number;
}

/** Walks every numbered item of `doc` with the number the editor shows for it. */
export function forEachNumbered(doc: PMNode, visit: NumberedVisitor): void {
  let runs = 0;
  const fresh = (): Run => ({ id: -1, index: -1, start: 1 });
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
        if (run.index < 0) {
          run.id = runs++;
          run.start = listStartOf(child.attrs.meta, depth);
        }
        run.index += 1;
        visit(child, pos, run.index, run.start + run.index, depth, run.id);
        // Only an item holding a sub-list needs a run of its own; most hold just their line.
        if (child.childCount > 1) walk(child, pos + 1, depth + 1, fresh());
        return;
      }

      // Every other block breaks the run. Its own children, if it has any, are
      // a run of their own, one level deeper when the block is a list item.
      run.index = -1;
      if (child.childCount > 1 || !child.firstChild?.isTextblock) {
        walk(child, pos + 1, isListItem(child) ? depth + 1 : depth, fresh());
      }
    });
  };

  walk(doc, 0, 0, fresh());
}

/**
 * The node decorations that number every numbered item in `doc`. Pure and
 * view-free, so the numbering is testable without mounting anything.
 */
export function listNumberDecorations(doc: PMNode): Decoration[] {
  return collect(doc).decorations;
}

function collect(doc: PMNode): { decorations: Decoration[]; anyStart: boolean } {
  const decorations: Decoration[] = [];
  let anyStart = false;
  forEachNumbered(doc, (node, pos, _index, number, depth) => {
    if (!anyStart && storedListStart(node.attrs.meta) !== null) anyStart = true;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-list-number': listLabel(number, depth) }));
  });
  return { decorations, anyStart };
}

function numberingOf(doc: PMNode): ListNumbering {
  const { decorations, anyStart } = collect(doc);
  return { decorations: DecorationSet.create(doc, decorations), anyStart };
}

/**
 * The plugin. Holds the current numbering in its state, exposing the decorations
 * through `props.decorations` so both the read-only and the editable view paint
 * the same numbers.
 */
export function numberedListPlugin(): Plugin<ListNumbering> {
  return new Plugin<ListNumbering>({
    key: listNumberKey,
    state: {
      init: (_config, state) => numberingOf(state.doc),
      apply(tr, old, _oldState, newState) {
        if (!tr.docChanged) return old;
        if (onlyEditsText([tr])) return { decorations: old.decorations.map(tr.mapping, tr.doc), anyStart: old.anyStart };
        return numberingOf(newState.doc);
      },
    },
    props: {
      decorations(this: Plugin<ListNumbering>, state: EditorState) {
        return this.getState(state)?.decorations;
      },
    },
  });
}
