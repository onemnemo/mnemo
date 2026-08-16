/**
 * Reserves a height for every top-level block, so the engine can skip laying out
 * the ones that are off screen.
 *
 * The CSS puts `content-visibility: auto` on each top-level block; this decides
 * the number that goes with it. The two halves are useless apart. Without the
 * declaration nothing is ever skipped, and without a reserved height a skipped
 * block measures zero, so the document collapses to the height of what is on
 * screen and the scrollbar becomes a lie that jumps under the user's hand.
 *
 * The number comes from the block modules themselves. Every module already
 * declares an `estimateHeight` (wrong-but-cheap, DOM-free, validated at registry
 * assembly), and this is what it was written for: the heading module knows its
 * own type scale, the code module knows source does not wrap, the two-column
 * module knows its height is its tallest lane. A single average would be wrong
 * by a factor on exactly the blocks that are tallest.
 *
 * Three things make this cheap enough to run under the caret:
 *
 *  - **`auto` in `contain-intrinsic-size` makes the estimate a first guess
 *    only.** Once a block has actually been laid out the engine remembers its
 *    real size and uses that when the block is skipped again, so the estimate
 *    stops mattering for anything the reader has scrolled past. It is declared
 *    twice, plain length first and then the `auto` form, because an engine that
 *    does not understand `auto <length>` drops that declaration and keeps the
 *    plain one, which is worth much more than nothing.
 *
 *  - **Range-local updates.** A keystroke re-estimates the block it landed in,
 *    not the document. The set is mapped through the transaction and only the
 *    top-level blocks overlapping a changed range are rebuilt.
 *
 *  - **No DOM.** The estimators are forbidden from touching it, so this never
 *    forces a layout to decide what to reserve, which would defeat the entire
 *    point of not laying the block out.
 *
 * Only top-level blocks are decorated, because only top-level blocks are the
 * ones the stylesheet skips. A nested block inside a skipped parent is already
 * skipped with it, and one inside a rendered parent has no size containment, so
 * a reserved height there would be ignored.
 */

import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { BlockRegistry } from '../registry/build';
import type { EstimateContext } from '../registry/types';
import { changedRanges, type DocRange } from './invariants';

const intrinsicSizeKey = new PluginKey<DecorationSet>('notes-intrinsic-size');

/**
 * The width the estimators measure against, matching the note column the page
 * lays out (`max-w-[760px]` less its horizontal padding).
 *
 * A constant rather than a measurement, on purpose. Reading the real width means
 * touching the DOM on every rebuild and re-estimating the whole document on
 * every resize, to refine a guess the engine throws away the moment the block
 * has been rendered once.
 */
export const NOTE_CONTENT_WIDTH = 680;

/** Both spellings, so an engine without `auto <length>` still reserves something. */
export function intrinsicSizeStyle(height: number): string {
  return `contain-intrinsic-size:${String(height)}px;contain-intrinsic-size:auto ${String(height)}px`;
}

/**
 * A recursive estimator over the registry.
 *
 * The context closes over itself so `estimateChild` reaches the same lookup: a
 * container's height is its children's, and the two-column module cannot compute
 * its own without asking.
 */
function heightEstimator(registry: BlockRegistry, availableWidth: number): (node: PMNode) => number {
  const context: EstimateContext = {
    availableWidth,
    estimateChild: (node) => estimate(node),
  };
  function estimate(node: PMNode): number {
    const estimator = registry.estimators.get(node.type.name);
    if (!estimator) return 0;
    return Math.round(estimator(node, context));
  }
  return estimate;
}

/**
 * Widens a changed range to the whole top-level blocks it touches.
 *
 * A node decoration has to cover a node exactly, so a range that starts inside
 * one block and ends inside another has to be grown outwards before anything is
 * rebuilt from it.
 */
function topLevelSpan(doc: PMNode, range: DocRange): DocRange | null {
  if (doc.childCount === 0) return null;
  const size = doc.content.size;
  const from = Math.max(0, Math.min(range.from, size));
  const to = Math.max(from, Math.min(range.to, size));

  let offset = 0;
  let start: number | null = null;
  let end = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const childEnd = offset + doc.child(i).nodeSize;
    // Touching, not merely overlapping: an edit at a block boundary belongs to
    // the block on both sides of it.
    if (childEnd >= from && offset <= to) {
      if (start === null) start = offset;
      end = childEnd;
    }
    offset = childEnd;
    if (offset > to) break;
  }
  return start === null ? null : { from: start, to: end };
}

/**
 * The changed ranges as whole-block spans, with touching spans joined.
 *
 * One transaction can report several ranges inside one block, and widening them
 * separately would rebuild that block once per range.
 */
function spansToRebuild(doc: PMNode, tr: Transaction): DocRange[] {
  const spans: { from: number; to: number }[] = [];
  for (const range of changedRanges([tr])) {
    const span = topLevelSpan(doc, range);
    if (!span) continue;
    const last = spans[spans.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else spans.push({ from: span.from, to: span.to });
  }
  return spans;
}

/**
 * The decorations a span replaces.
 *
 * `find` also reports a decoration that merely touches the span's edge, which is
 * the neighbouring block's and is not being rebuilt. Dropping it there would
 * leave that block with no reserved height at all.
 */
function staleIn(set: DecorationSet, span: DocRange): Decoration[] {
  return set.find(span.from, span.to).filter((deco) => deco.to > span.from && deco.from < span.to);
}

/**
 * One node decoration per top-level block fully inside `span`.
 *
 * A block whose module has no usable estimate is left undecorated rather than
 * given a zero, so the stylesheet's fallback height governs it. Reserving
 * nothing is the one outcome worth avoiding: it collapses the block and takes
 * the scrollbar with it.
 */
function decorationsIn(
  doc: PMNode,
  span: DocRange,
  estimate: (node: PMNode) => number,
): Decoration[] {
  const out: Decoration[] = [];
  let offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const end = offset + child.nodeSize;
    if (offset >= span.from && end <= span.to) {
      const height = estimate(child);
      if (height > 0) out.push(Decoration.node(offset, end, { style: intrinsicSizeStyle(height) }));
    }
    offset = end;
    if (offset > span.to) break;
  }
  return out;
}

export function intrinsicSizePlugin(
  registry: BlockRegistry,
  availableWidth: number = NOTE_CONTENT_WIDTH,
): Plugin<DecorationSet> {
  const estimate = heightEstimator(registry, availableWidth);

  return new Plugin<DecorationSet>({
    key: intrinsicSizeKey,
    state: {
      init(_config, state) {
        const whole = { from: 0, to: state.doc.content.size };
        return DecorationSet.create(state.doc, decorationsIn(state.doc, whole, estimate));
      },
      apply(tr, set) {
        if (!tr.docChanged) return set;
        let next = set.map(tr.mapping, tr.doc);
        for (const span of spansToRebuild(tr.doc, tr)) {
          next = next.remove(staleIn(next, span));
          next = next.add(tr.doc, decorationsIn(tr.doc, span, estimate));
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        return intrinsicSizeKey.getState(state);
      },
    },
  });
}
