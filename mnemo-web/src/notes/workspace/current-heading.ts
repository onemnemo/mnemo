/**
 * The index of the last heading whose top is at or above `threshold`, or 0 when
 * none is, so the first heading stands for the stretch before it.
 *
 * Top-level block tops only grow in document order, which lets a binary search
 * answer in a handful of layout reads rather than one per heading. A `topOf`
 * that throws counts as below.
 */
export function currentHeadingIndex(
  count: number,
  topOf: (index: number) => number,
  threshold: number,
): number {
  let low = 0;
  let high = count - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    let above: boolean;
    try {
      above = topOf(mid) <= threshold;
    } catch {
      above = false;
    }
    if (above) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
