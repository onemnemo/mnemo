/**
 * The shape a block selection paints: one band per selected block, in a run
 * that reads as a single object.
 *
 * A selection of whole blocks is an answer about structure, so it has to be
 * drawn as structure: constant edges, a shape wider than any line inside it,
 * and no ragged word-shaped boxes. Left to the blocks' own boxes the bands
 * would stop at each block's border and leave the leading between them
 * showing, which is worst exactly where it is most visible, under a heading
 * carrying 28px of lead. So a band's edge between two selected blocks is the
 * midpoint of the space between them: the run covers its own gaps.
 *
 * The one divergence from the prototype, and it is deliberate: the prototype
 * merges a run into a single rectangle, and this keeps a hairline of daylight
 * at each junction so the run still reads as the blocks it is made of.
 *
 * Rects come in viewport space and in document order. Two rects that overlap
 * vertically are side by side (the cells of a two-column row), and there is no
 * gap between them to divide: each keeps its own padded edge.
 */

export interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface Band {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** How far a band sits proud of the block at the ends of a run. Tight to the glyph box reads as a bug. */
const PAD = 2;
/** The daylight left between two bands in a run. */
const GAP = 2;
/**
 * How far a band reaches past the text column. The shape has to be wider than
 * any line it covers or it still reads as a highlighted sentence.
 */
const BLEED = 6;

/** Whether `b` starts below `a` ends, i.e. the two are stacked rather than side by side. */
function stacked(a: Rect, b: Rect): boolean {
  return b.top >= a.bottom;
}

/**
 * Bands for `rects`, which must be in document order.
 *
 * `contiguous(i)` says whether the block at `i` and the one at `i + 1` are
 * neighbours in the document: only then does the space between them belong to
 * the selection and get divided. A gap in the selection keeps both padded
 * edges, so two separate runs never look like one.
 */
export function selectionBands(
  rects: readonly Rect[],
  contiguous: (index: number) => boolean,
): Band[] {
  const bands: Band[] = [];
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const previous = i > 0 ? rects[i - 1] : null;
    const next = i + 1 < rects.length ? rects[i + 1] : null;

    const joinedAbove = previous !== null && contiguous(i - 1) && stacked(previous, rect);
    const joinedBelow = next !== null && contiguous(i) && stacked(rect, next);

    const top = joinedAbove ? (previous.bottom + rect.top) / 2 + GAP / 2 : rect.top - PAD;
    const bottom = joinedBelow ? (rect.bottom + next.top) / 2 - GAP / 2 : rect.bottom + PAD;

    bands.push({
      top,
      height: Math.max(0, bottom - top),
      left: rect.left - BLEED,
      width: Math.max(0, rect.right - rect.left + BLEED * 2),
    });
  }
  return bands;
}
