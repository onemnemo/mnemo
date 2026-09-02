import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';

import type { BlockRegistry } from '../editor/registry/build';
import { getBlockSelection, subscribeBlockSelection } from './block-selection-plugin';
import { coveredBlockRanges } from './delete-selected';
import { firstRowTouching, lastRowTouching, marqueeRows } from './marquee-hit';
import { selectionBands, type Band, type Rect } from './selection-bands';

/**
 * What a block selection looks like: a floating layer of bands over the blocks
 * it covers.
 *
 * Painted *over* the prose rather than behind it. A code block, a callout and a
 * figure each carry their own opaque surface, so a tint underneath them selects
 * three blocks and shows one; the fill is faint enough that the text it covers
 * keeps its own colour. That is also why it is a layer and not the block's own
 * background: a band has to reach into the leading between two blocks and past
 * the measure on both sides, and the blocks carry `content-visibility` paint
 * containment, which clips anything drawn outside their own box.
 *
 * The cost of a layer is measuring, so it measures as little as it can: a
 * binary search over the top-level rows finds the ones the viewport covers, and
 * only those are read. A selection of ten thousand blocks paints the same
 * handful of bands as a selection of three, and scrolling re-reads that same
 * handful. The blocks off screen need no band, because there is nothing there
 * to see; one row of margin on each side keeps the band that spans the fold
 * dividing its gap correctly.
 *
 * A row is painted whole only when the selection covers all of it. Anything
 * less is painted from the delete plan, so the highlight and the key can never
 * disagree: a table with one cell in the selection changes nothing on Backspace
 * and so lights up nothing, where claiming the row would promise to remove a
 * table that is about to survive. The plan is a walk of the document, so it is
 * built only when a partly covered row turns up, which an ordinary selection of
 * whole rows never produces.
 */

/** One measured block: its rect, and which top-level row it belongs to. */
interface Entry {
  readonly rect: Rect;
  readonly row: number;
}

function toRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}

/**
 * The bands to paint for the current selection, in viewport space, or an empty
 * array when nothing selected is on screen.
 */
function measureBands(
  view: EditorView,
  registry: BlockRegistry,
  container: HTMLElement,
): Band[] {
  const selected = getBlockSelection(view.state).selected;
  if (selected.size === 0) return [];

  const root = view.dom;
  const rows = marqueeRows(view.state.doc, registry);
  const count = Math.min(root.children.length, rows.length);
  if (count === 0) return [];

  const rectOf = (index: number) => root.children[index].getBoundingClientRect();
  const bounds = container.getBoundingClientRect();
  const first = Math.max(0, firstRowTouching(count, (index) => rectOf(index).bottom, bounds.top) - 1);
  const last = Math.min(count - 1, lastRowTouching(count, (index) => rectOf(index).top, bounds.bottom) + 1);

  let plan: ReturnType<typeof coveredBlockRanges> | null = null;
  const coveredWithin = (from: number, to: number) => {
    plan ??= coveredBlockRanges(view.state.doc, registry, selected);
    return plan.filter((range) => range.from >= from && range.from < to);
  };

  const entries: Entry[] = [];
  for (let index = first; index <= last; index++) {
    const row = rows[index];
    if (row.sids.length > 0 && row.sids.every((sid) => selected.has(sid))) {
      entries.push({ rect: toRect(root.children[index]), row: index });
      continue;
    }
    if (!row.sids.some((sid) => selected.has(sid))) continue;
    // Partly covered: one band per block the delete plan would take, which is
    // the selected lane of a two-column row, and nothing at all inside a table.
    const end = rows[index + 1]?.pos ?? view.state.doc.content.size;
    for (const range of coveredWithin(row.pos, end)) {
      const el = view.nodeDOM(range.from);
      if (el instanceof HTMLElement) entries.push({ rect: toRect(el), row: index });
    }
  }

  return selectionBands(
    entries.map((entry) => entry.rect),
    (index) => entries[index + 1].row - entries[index].row <= 1,
  );
}

/** Whether two runs of bands would paint the same, so an unchanged one can keep its render. */
function sameBands(a: readonly Band[], b: readonly Band[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (band, index) =>
        band.top === b[index].top &&
        band.height === b[index].height &&
        band.left === b[index].left &&
        band.width === b[index].width,
    )
  );
}

export function SelectionBands({
  view,
  registry,
  scrollRef,
}: {
  view: EditorView;
  registry: BlockRegistry;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const [bands, setBands] = useState<Band[]>([]);
  const [clip, setClip] = useState<DOMRect | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const paint = () => {
      frame.current = null;
      setClip(container.getBoundingClientRect());
      const next = measureBands(view, registry, container);
      // The same geometry on every scroll frame of an unmoved selection is the
      // common case; re-rendering it would repaint the layer for nothing.
      setBands((prev) => (sameBands(prev, next) ? prev : next));
    };

    const schedule = () => {
      frame.current ??= requestAnimationFrame(paint);
    };

    paint();
    // A selection change paints at once rather than waiting for a frame: the
    // change already arrives at most once per drag frame, and a hop through the
    // scheduler would leave the marquee drawing a band the selection under it
    // has not caught up with. Only geometry changes, which arrive in bursts,
    // need the throttle.
    const stop = subscribeBlockSelection(view, paint);
    // Capture: the note scrolls in an ancestor of the editor, and a nested
    // scroller (a code block, a wide table) moves the blocks too.
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      stop();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [view, registry, scrollRef]);

  if (bands.length === 0 || !clip) return null;
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-[20] overflow-hidden"
      style={{ left: clip.left, top: clip.top, width: clip.width, height: clip.height }}
    >
      {bands.map((band, index) => (
        <div
          key={index}
          className="notes-selection-band absolute"
          style={{
            left: band.left - clip.left,
            top: band.top - clip.top,
            width: band.width,
            height: band.height,
          }}
        />
      ))}
    </div>,
    document.body,
  );
}
