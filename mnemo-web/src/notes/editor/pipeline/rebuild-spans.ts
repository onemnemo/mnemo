/**
 * The range-local rebuild helper shared by every decoration plugin that maps
 * its set through a transaction and rebuilds only the top-level blocks the
 * transaction touched, rather than the whole document: intrinsic-size's
 * reserved heights and the code highlighter's token colours both work this
 * way, and used to carry their own copy of it.
 *
 * The two copies drifted to slightly different widening predicates before
 * this was pulled out. The one kept here is the highlighter's: an inclusive
 * "touching, not merely overlapping" test, checked per block against every
 * changed range rather than per range against the whole document. Both
 * shapes were swept against each other across thousands of randomized edits,
 * including deletes and inserts at the very last position, and never
 * disagreed, so the unification is behavior preserving; this shape survives
 * because it is the one proven against the harder case (see
 * `highlight-incremental.test.ts`), not because the other was wrong.
 */

import type { Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { changedRanges, type DocRange } from './invariants';

/**
 * The top-level blocks a transaction touched, as absolute spans of the new
 * document, with neighbours joined.
 *
 * Widened to whole top-level blocks rather than used as reported, because a
 * node decoration has to cover a node exactly, and because the reported range
 * says only where the document differs, not everything that needs recomputing
 * from it. Joining two blocks deletes the boundary between them and reports
 * an empty range where it used to be; the block that survives holds content
 * that was never a single block before. Counting a range as touching a block
 * it merely abuts is what covers that, and it costs at worst one extra
 * block's worth of work on an ordinary keystroke.
 */
export function spansToRebuild(doc: PMNode, tr: Transaction): DocRange[] {
  const ranges = changedRanges([tr]);
  const furthest = ranges[ranges.length - 1];
  if (!furthest) return [];

  const spans: { from: number; to: number }[] = [];
  let offset = 0;
  for (let i = 0; i < doc.childCount && offset <= furthest.to; i++) {
    const end = offset + doc.child(i).nodeSize;
    if (ranges.some((range) => end >= range.from && offset <= range.to)) {
      const previous = spans[spans.length - 1];
      if (previous && previous.to === offset) previous.to = end;
      else spans.push({ from: offset, to: end });
    }
    offset = end;
  }
  return spans;
}

/**
 * The decorations a span replaces.
 *
 * `find` also reports a decoration that merely touches the span's edge, which
 * belongs to the neighbouring block and is not being rebuilt. Dropping it
 * there would leave that block undecorated, or uncoloured, until something
 * else happened to touch it.
 */
export function staleIn(set: DecorationSet, span: DocRange): Decoration[] {
  return set.find(span.from, span.to).filter((deco) => deco.to > span.from && deco.from < span.to);
}
