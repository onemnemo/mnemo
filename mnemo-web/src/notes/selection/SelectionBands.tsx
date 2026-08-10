import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';

import type { BlockRegistry } from '../editor/registry/build';
import { getBlockSelection, subscribeBlockSelection } from './block-selection-plugin';
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

  const entries: Entry[] = [];
  for (let index = first; index <= last; index++) {
    const row = rows[index];
    if (row.cellChildren) {
      // Only the cells that are actually selected: a band across the whole row
      // would claim the neighbouring lane as well.
      for (const child of row.cellChildren) {
        if (!child.sids.some((sid) => selected.has(sid))) continue;
        const el = view.nodeDOM(child.pos);
        if (el instanceof HTMLElement) entries.push({ rect: toRect(el), row: index });
      }
      continue;
    }
    if (!row.sids.some((sid) => selected.has(sid))) continue;
    entries.push({ rect: toRect(root.children[index]), row: index });
  }

  return selectionBands(
    entries.map((entry) => entry.rect),
    (index) => entries[index + 1].row - entries[index].row <= 1,
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
      setBands((prev) =>
        prev.length === next.length &&
        prev.every((band, i) => band.top === next[i].top && band.height === next[i].height && band.left === next[i].left)
          ? prev
          : next,
      );
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
      className="pointer-events-none fixed z-[996] overflow-hidden"
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
