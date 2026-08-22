import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from 'prosemirror-view';

import type { RefObject } from 'react';
import type { BlockRegistry } from '../editor/registry/build';
import { type BlockSelection } from './block-selection';
import { clearBlockSelection, setBlockSelection } from './block-selection-plugin';
import {
  bandFrom,
  firstRowTouching,
  lastRowTouching,
  marqueeRows,
  rectsIntersect,
  type Point,
} from './marquee-hit';
import { isMarqueeOrigin } from './marquee-origin';

/**
 * The rubber-band marquee that selects blocks, drawn from the empty page around
 * the editor.
 *
 * A document has two things a pointer can mean, and the whole design rests on
 * never showing both answers at once. The press settles it: inside the editable
 * root you are pointing at language and the browser's own text selection is the
 * right answer, across as many blocks as the drag reaches; outside it you are
 * pointing at structure and this marquee is. {@link isMarqueeOrigin} holds the
 * line, and holds it once, before the drag exists.
 *
 * The band drawing is {@link SelectionBands}; this owns only the gesture.
 *
 * It is one overlay per note, not a widget per block, for the same two reasons
 * the gutter is: paint containment would clip a band drawn inside a block, and a
 * single element is O(1) against the tens-of-thousands target.
 *
 * The band is anchored in the scroll container's content space, so scrolling
 * mid-drag - by wheel or by the edge auto-scroll below - grows the band rather
 * than dragging the anchor along. Each frame re-derives the covered set from
 * the band against the document's real geometry (see `marquee-hit.ts`): a
 * binary search over the top-level rows bounds the work to the covered range,
 * and blocks that have scrolled out of the viewport are tested by the same
 * rects as visible ones, so nothing already swept is lost. Selecting sits in
 * plugin state through {@link setBlockSelection}, so it dirties nothing; the
 * highlight is a node decoration, and off-screen selected blocks keep their
 * decoration at zero paint cost because `content-visibility` already skips
 * them.
 *
 * The unit is the deepest practical block: a plain top-level block selects
 * whole, a two-column row selects per cell child, the desktop's own granularity.
 *
 * The auto-scroll constants are the desktop's block-drag ones (and
 * usePointerDrag's): a 40px edge zone, 9-18px per 50ms tick ramped by how deep
 * the pointer sits in the zone.
 */

const START_THRESHOLD = 6;
const SCROLL_ZONE = 40;
const SCROLL_MIN_STEP = 9;
const SCROLL_MAX_STEP = 18;
const SCROLL_INTERVAL_MS = 50;

interface DragState {
  /** Press point in the scroll container's content space; never moves. */
  anchor: Point;
  /** Latest pointer position in viewport space. */
  pointer: Point;
  active: boolean;
  frame: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function BlockSelectionOverlay({
  view,
  registry,
  scrollRef,
}: {
  view: EditorView;
  registry: BlockRegistry;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let scrollTimer: ReturnType<typeof setInterval> | null = null;

    const toContent = (clientX: number, clientY: number): Point => {
      const rect = container.getBoundingClientRect();
      return { x: clientX - rect.left + container.scrollLeft, y: clientY - rect.top + container.scrollTop };
    };

    const paintAndSelect = () => {
      const state = drag.current;
      if (!state?.active) return;

      const rect = container.getBoundingClientRect();
      const band = bandFrom(state.anchor, toContent(state.pointer.x, state.pointer.y));

      // The band in viewport space, unclamped: hit-testing must see the parts
      // that have scrolled past the fold.
      const vBand = {
        left: band.left + rect.left - container.scrollLeft,
        right: band.right + rect.left - container.scrollLeft,
        top: band.top + rect.top - container.scrollTop,
        bottom: band.bottom + rect.top - container.scrollTop,
      };

      // The painted div is clamped to the container, so the band never draws
      // over the breadcrumb or the sidebar.
      const bandEl = bandRef.current;
      if (bandEl) {
        const left = Math.max(vBand.left, rect.left);
        const top = Math.max(vBand.top, rect.top);
        const width = Math.max(0, Math.min(vBand.right, rect.right) - left);
        const height = Math.max(0, Math.min(vBand.bottom, rect.bottom) - top);
        bandEl.style.left = `${String(left)}px`;
        bandEl.style.top = `${String(top)}px`;
        bandEl.style.width = `${String(width)}px`;
        bandEl.style.height = `${String(height)}px`;
        // The div mounts unstyled a frame before the first paint reaches it;
        // hidden until then, or its bare border draws a dot at the viewport corner.
        bandEl.style.visibility = 'visible';
      }

      const root = view.dom;
      const rows = marqueeRows(view.state.doc, registry);
      const count = Math.min(root.children.length, rows.length);
      const rectOf = (index: number) => root.children[index].getBoundingClientRect();

      const first = firstRowTouching(count, (index) => rectOf(index).bottom, vBand.top);
      const last = lastRowTouching(count, (index) => rectOf(index).top, vBand.bottom);

      const selected = new Set<string>();
      let anchorSid: string | null = null;
      const add = (sids: readonly string[]) => {
        for (const sid of sids) {
          anchorSid ??= sid;
          selected.add(sid);
        }
      };
      for (let index = first; index <= last && index < count; index++) {
        if (!rectsIntersect(vBand, rectOf(index))) continue;
        const row = rows[index];
        if (!row.cellChildren) {
          add(row.sids);
          continue;
        }
        for (const child of row.cellChildren) {
          const el = view.nodeDOM(child.pos);
          if (!(el instanceof HTMLElement)) continue;
          if (!rectsIntersect(vBand, el.getBoundingClientRect())) continue;
          add(child.sids);
        }
      }

      const selection: BlockSelection = { selected, anchorSid };
      setBlockSelection(view, selection);
    };

    const scheduleFrame = () => {
      const state = drag.current;
      if (!state || state.frame !== null) return;
      state.frame = requestAnimationFrame(() => {
        if (drag.current) drag.current.frame = null;
        paintAndSelect();
      });
    };

    // A held pointer at the container's edge scrolls the note under the band,
    // which is how a marquee reaches past the viewport.
    const autoScrollTick = () => {
      const state = drag.current;
      if (!state?.active) return;
      const rect = container.getBoundingClientRect();
      const y = state.pointer.y;

      let delta = 0;
      if (y < rect.top + SCROLL_ZONE) {
        const intensity = clamp((rect.top + SCROLL_ZONE - y) / SCROLL_ZONE, 0, 1);
        delta = -(SCROLL_MIN_STEP + (SCROLL_MAX_STEP - SCROLL_MIN_STEP) * intensity);
      } else if (y > rect.bottom - SCROLL_ZONE) {
        const intensity = clamp((y - (rect.bottom - SCROLL_ZONE)) / SCROLL_ZONE, 0, 1);
        delta = SCROLL_MIN_STEP + (SCROLL_MAX_STEP - SCROLL_MIN_STEP) * intensity;
      }
      if (delta === 0) return;

      const before = container.scrollTop;
      container.scrollTop = clamp(before + delta, 0, container.scrollHeight - container.clientHeight);
      if (container.scrollTop !== before) scheduleFrame();
    };

    const end = (focus: boolean) => {
      const state = drag.current;
      if (state?.frame !== null && state?.frame !== undefined) cancelAnimationFrame(state.frame);
      drag.current = null;
      if (scrollTimer !== null) {
        clearInterval(scrollTimer);
        scrollTimer = null;
      }
      view.dom.removeAttribute('data-block-drag');
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey, true);
      container.removeEventListener('scroll', onScroll);
      // Of the two { once: true } listeners, only the one whose event ended the
      // gesture removed itself; the sibling must be removed here or it survives
      // into the session and a later unrelated pointercancel would clear a
      // selection the user still holds. Removing an already-gone one is a no-op.
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      // A committed marquee takes focus so the following Delete or Escape reaches
      // the editor's block-selection handler.
      if (focus && !view.hasFocus()) view.focus();
    };

    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      state.pointer = { x: event.clientX, y: event.clientY };

      if (!state.active) {
        const cur = toContent(event.clientX, event.clientY);
        if (Math.hypot(cur.x - state.anchor.x, cur.y - state.anchor.y) < START_THRESHOLD) return;
        state.active = true;
        // The band is about to sweep across the prose. Nothing under it is being
        // read as words for the rest of the drag, so the editor stops offering a
        // text cursor and stops painting a text selection beneath the bands.
        view.dom.setAttribute('data-block-drag', '');
        setDragging(true);
        scrollTimer ??= setInterval(autoScrollTick, SCROLL_INTERVAL_MS);
      }
      scheduleFrame();
    };

    // A wheel scroll mid-drag moves the document under the held band exactly
    // like the auto-scroll does; both re-derive through the same frame.
    const onScroll = () => {
      if (drag.current?.active) scheduleFrame();
    };

    const onUp = () => {
      const wasActive = drag.current?.active ?? false;
      end(wasActive);
    };

    const onCancel = () => {
      // Only a live gesture has anything to abandon; defence in depth against a
      // stray event reaching a handler that outlived its gesture.
      if (!drag.current) return;
      clearBlockSelection(view);
      end(false);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearBlockSelection(view);
        end(false);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || drag.current) return;
      // A press this does not own is not watched at all: a drag whose meaning
      // can still change is a drag two selections can both claim.
      if (!isMarqueeOrigin(event.target)) return;

      // Arming clears the current selection, like the desktop: an empty-space
      // press with no drag is a plain "deselect".
      clearBlockSelection(view);

      drag.current = {
        anchor: toContent(event.clientX, event.clientY),
        pointer: { x: event.clientX, y: event.clientY },
        active: false,
        frame: null,
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
      window.addEventListener('pointercancel', onCancel, { once: true });
      window.addEventListener('keydown', onKey, true);
      container.addEventListener('scroll', onScroll);
    };

    container.addEventListener('pointerdown', onPointerDown);
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey, true);
      container.removeEventListener('scroll', onScroll);
      // These are registered per-gesture with { once: true }, so they normally
      // clear themselves; removing them here covers a note switch mid-drag,
      // where a later pointerup/cancel would otherwise dispatch to a torn-down
      // view.
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (scrollTimer !== null) clearInterval(scrollTimer);
      const frame = drag.current?.frame;
      if (frame !== null && frame !== undefined) cancelAnimationFrame(frame);
      drag.current = null;
      view.dom.removeAttribute('data-block-drag');
    };
  }, [view, registry, scrollRef]);

  if (!dragging) return null;
  return createPortal(
    <div ref={bandRef} className="notes-marquee pointer-events-none fixed z-[21]" style={{ visibility: 'hidden' }} />,
    document.body,
  );
}
