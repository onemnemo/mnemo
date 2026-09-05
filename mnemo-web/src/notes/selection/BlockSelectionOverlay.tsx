import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

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
import { restoreTextSelection, suppressTextSelection } from '../../lib/dnd/drag-select';

/**
 * The block marquee gesture, owned exclusively by the editor's explicit gutter.
 * Presses inside ProseMirror belong to native text selection for their entire
 * lifetime, while every other part of the note keeps its own pointer behavior.
 *
 * The painted box stays anchored to the exact press, and the same box does the
 * hit-testing: a block is selected only while the box overlaps its rect on
 * both axes, a two-column row per lane. A sweep that stays in the margin has
 * not reached any block yet. The block bands make the selection visible
 * without moving the box.
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
/** How far into the text column a margin click probes for the line it is beside. */
const TEXT_COLUMN_INSET = 8;
const SCROLL_ZONE = 40;
const SCROLL_MIN_STEP = 9;
const SCROLL_MAX_STEP = 18;
const SCROLL_INTERVAL_MS = 50;

interface DragState {
  /** Pointer that owns this gesture; events from every other pointer are ignored. */
  pointerId: number;
  /** Press point in the scroll container's content space; never moves. */
  anchor: Point;
  /** Press point in viewport space, which is what a caret is resolved against. */
  press: Point;
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
  paneRef,
  scrollRef,
}: {
  view: EditorView;
  registry: BlockRegistry;
  paneRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    const pane = paneRef.current;
    if (!container || !pane) return;
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
      // The binary search bounds the vertical range; every row inside it still
      // has to meet the band on the horizontal axis, because the marquee
      // selects exactly what it touches: a sweep down the margin claims no
      // block until the box crosses into one. A two-column row is asked per
      // lane, so a band inside one lane never claims the neighbour.
      for (let index = first; index <= last && index < count; index++) {
        const row = rows[index];
        if (!row.cellChildren) {
          if (rectsIntersect(vBand, rectOf(index))) add(row.sids);
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
      restoreTextSelection();
      view.dom.removeAttribute('data-block-marquee');
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey, true);
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      // A committed marquee takes focus so the following Delete or Escape reaches
      // the editor's block-selection handler.
      if (focus && !view.hasFocus()) view.focus();
    };

    const clearNativeSelection = () => {
      document.getSelection()?.removeAllRanges();
      if (!view.state.selection.empty) {
        const { doc, selection } = view.state;
        view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(selection.from))));
      }
    };

    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      state.pointer = { x: event.clientX, y: event.clientY };

      const cur = toContent(event.clientX, event.clientY);
      const moved = Math.hypot(cur.x - state.anchor.x, cur.y - state.anchor.y) >= START_THRESHOLD;

      if (!state.active && !moved) return;

      if (!state.active) {
        state.active = true;
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

    /**
     * The caret a click in the margin asks for.
     *
     * The press already called `preventDefault`, so the browser placed none of
     * its own, and the point it happened at is outside the document's box, where
     * `posAtCoords` answers nothing. Pulling the probe just inside the text
     * column at the same height reads the line the click was beside, which is
     * what clicking a page's margin means everywhere it means anything.
     */
    const placeCaret = (point: Point): boolean => {
      const rootRect = view.dom.getBoundingClientRect();
      const left = clamp(point.x, rootRect.left + TEXT_COLUMN_INSET, rootRect.right - TEXT_COLUMN_INSET);
      const found = view.posAtCoords({ left, top: point.y });
      if (!found) return false;
      const { doc } = view.state;
      const pos = clamp(found.pos, 0, doc.content.size);
      view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos))));
      return true;
    };

    const onUp = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      // A press that never became a marquee is a click, and a click has to leave
      // the caret somewhere: without this the gesture takes the block selection
      // away and puts nothing in its place.
      const placed = state.active ? false : placeCaret(state.press);
      end(state.active || placed);
    };

    const onCancel = (event: PointerEvent) => {
      // Only a live gesture has anything to abandon; defence in depth against a
      // stray event reaching a handler that outlived its gesture.
      if (!drag.current || event.pointerId !== drag.current.pointerId) return;
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
      if (event.button !== 0 || !event.isPrimary || drag.current) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest(
          'button, a, input, textarea, select, [role="button"], [role="menu"], [role="menuitem"], [role="tab"], .notes-column-splitter, .notes-table',
        )
      ) return;
      // The page itself, plus the one chrome layer that floats over the margin:
      // the block gutter follows the pointer to the very strip this gesture is
      // aimed at, so leaving it out would make the handle's own row a dead zone.
      // Every other layer the pane stacks over the note (the save row, the find
      // panel) keeps its presses, which is why this asks where the press landed
      // rather than trusting the pane to only ever hold the note.
      if (!container.contains(target) && !target.closest('[data-block-gutter]')) return;
      if (target.closest('.ProseMirror')) return;

      // A press on the page's own empty space is a plain deselect, the way the
      // desktop reads it, whether or not a marquee follows it. It comes before
      // the geometry below because the margin beside the title and the space
      // past the last block are still somewhere you can put a gesture down to
      // mean "not those blocks". A press on the gutter chrome row is not that:
      // the row can float over the content column, and a press there that the
      // geometry turns away must not cost the user a standing selection.
      const fromGutterChrome = target.closest('[data-block-gutter]') !== null;
      if (!fromGutterChrome) clearBlockSelection(view);

      const root = view.dom;
      const first = root.firstElementChild;
      const last = root.lastElementChild;
      if (!first || !last) return;
      const containerRect = container.getBoundingClientRect();
      // clientWidth rather than the border box: the reserved scrollbar gutter is
      // the scrollbar's strip to answer for, not the page's margin.
      const contentRight = containerRect.left + container.clientWidth;
      if (event.clientX < containerRect.left || event.clientX > contentRight) return;
      const rootRect = root.getBoundingClientRect();
      const inLeftMargin = event.clientX <= rootRect.left;
      const inRightMargin = event.clientX >= rootRect.right && event.clientX <= contentRight;
      if (!inLeftMargin && !inRightMargin) return;
      if (
        event.clientY < first.getBoundingClientRect().top ||
        event.clientY > last.getBoundingClientRect().bottom
      ) return;

      if (fromGutterChrome) clearBlockSelection(view);
      event.preventDefault();
      suppressTextSelection();
      view.dom.setAttribute('data-block-marquee', '');
      clearNativeSelection();

      drag.current = {
        pointerId: event.pointerId,
        anchor: toContent(event.clientX, event.clientY),
        press: { x: event.clientX, y: event.clientY },
        pointer: { x: event.clientX, y: event.clientY },
        active: false,
        frame: null,
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
      container.addEventListener('scroll', onScroll);
    };

    pane.addEventListener('pointerdown', onPointerDown);
    return () => {
      pane.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey, true);
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (scrollTimer !== null) clearInterval(scrollTimer);
      const frame = drag.current?.frame;
      if (frame !== null && frame !== undefined) cancelAnimationFrame(frame);
      drag.current = null;
      restoreTextSelection();
      view.dom.removeAttribute('data-block-marquee');
    };
  }, [view, registry, paneRef, scrollRef]);

  if (!dragging) return null;
  return createPortal(
    <div ref={bandRef} className="notes-marquee pointer-events-none fixed z-[21]" style={{ visibility: 'hidden' }} />,
    document.body,
  );
}
