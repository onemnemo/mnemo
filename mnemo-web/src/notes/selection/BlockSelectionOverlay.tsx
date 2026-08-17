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

/**
 * Every drag that means "these blocks": the rubber-band marquee on the editor's
 * empty space, and the handover that turns a text drag into a block selection
 * the moment it leaves the block it started in.
 *
 * A document has two things a pointer can mean, and the whole design rests on
 * never showing both answers at once. Inside one block the browser's own text
 * selection is right: words, a caret, a ragged right edge, because you are
 * pointing at language. Across two blocks it is wrong: three differently shaped
 * highlights with the leading showing between them, because the question has
 * become one about structure. So the instant the pointer crosses into another
 * block the text range is dropped, the bands appear, and the browser is stopped
 * from painting text selection for the rest of the drag.
 *
 * The band drawing is {@link SelectionBands}; this owns only the gestures.
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

/**
 * What the current drag has turned out to mean. A press inside a block is
 * `text` until it leaves that block, and a press on empty space can only ever
 * have meant blocks.
 */
type DragKind = 'marquee' | 'text' | 'range';

interface DragState {
  kind: DragKind;
  /** Press point in the scroll container's content space; never moves. */
  anchor: Point;
  /** Latest pointer position in viewport space. */
  pointer: Point;
  /** For a range drag: the top-level row the press landed in. */
  anchorRow: number;
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

    /**
     * The top-level row at a viewport height. The gap above a block belongs to
     * that block: a pointer in it is reaching for what comes next.
     */
    const rowAt = (clientY: number): number => {
      const root = view.dom;
      const rows = marqueeRows(view.state.doc, registry);
      const count = Math.min(root.children.length, rows.length);
      if (count === 0) return -1;
      const index = firstRowTouching(
        count,
        (i) => root.children[i].getBoundingClientRect().bottom,
        clientY,
      );
      return Math.min(index, count - 1);
    };

    /** Select every block in the rows from the drag's anchor row to `to`, inclusive. */
    const selectRows = (from: number, to: number) => {
      const rows = marqueeRows(view.state.doc, registry);
      const lo = Math.max(0, Math.min(from, to));
      const hi = Math.min(rows.length - 1, Math.max(from, to));
      const selected = new Set<string>();
      for (let index = lo; index <= hi; index++) {
        for (const sid of rows[index].sids) selected.add(sid);
      }
      // The anchor is the row the drag started in, whichever end it now sits at,
      // so a later shift-click extends from where the user last pointed.
      setBlockSelection(view, { selected, anchorSid: rows[from]?.sids[0] ?? null });
    };

    const paintAndSelect = () => {
      const state = drag.current;
      if (!state?.active) return;

      if (state.kind === 'range') {
        const row = rowAt(state.pointer.y);
        if (row >= 0) selectRows(state.anchorRow, row);
        return;
      }

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
      document.body.style.userSelect = '';
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

    /**
     * Hand the drag over from text to blocks.
     *
     * The text range goes first and the caret is collapsed to where the press
     * landed, in one deliberate transaction: leaving the browser to keep
     * extending its own selection under the bands is what would put two answers
     * on screen, and a collapsed caret is also a selection ProseMirror already
     * agrees with, so nothing dispatches a selection change behind us that would
     * drop the block selection the instant it is made.
     */
    const beginRange = () => {
      document.getSelection()?.removeAllRanges();
      const { doc, selection } = view.state;
      view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(selection.from))));
      view.dom.setAttribute('data-block-drag', '');
    };

    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      state.pointer = { x: event.clientX, y: event.clientY };

      const cur = toContent(event.clientX, event.clientY);
      const moved = Math.hypot(cur.x - state.anchor.x, cur.y - state.anchor.y) >= START_THRESHOLD;

      if (state.kind === 'text') {
        // A drag that stays inside its own block is still about words; only
        // crossing the boundary means the gesture was about blocks.
        if (!moved) return;
        const row = rowAt(event.clientY);
        if (row < 0 || row === state.anchorRow) return;
        state.kind = 'range';
        beginRange();
      } else if (!state.active && !moved) {
        return;
      }

      if (!state.active) {
        state.active = true;
        document.body.style.userSelect = 'none';
        // Only the marquee paints a rubber band; a range drag is drawn entirely
        // by the selection it is making.
        if (state.kind === 'marquee') setDragging(true);
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
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // A press on interactive chrome belongs to that control.
      if (target.closest('button, a, input, textarea, [role="menuitem"], .notes-column-splitter')) return;
      // A drag inside a table is about cells. Two selection systems answering one
      // gesture is exactly what this bail exists to prevent, and the table's own
      // rectangle drag is the more specific of the two.
      if (target.closest('.notes-table')) return;

      const inText = target.closest('.ProseMirror') !== null;
      const listen = () => {
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp, { once: true });
        window.addEventListener('pointercancel', onCancel, { once: true });
        window.addEventListener('keydown', onKey, true);
        container.addEventListener('scroll', onScroll);
      };

      if (inText) {
        // Left alone: this press is a caret, and the browser owns the text drag
        // that may follow. It is watched only so that leaving the block can hand
        // the gesture over. ProseMirror's own selection change clears any block
        // selection standing, so nothing is cleared here.
        const row = rowAt(event.clientY);
        if (row < 0) return;
        drag.current = {
          kind: 'text',
          anchor: toContent(event.clientX, event.clientY),
          pointer: { x: event.clientX, y: event.clientY },
          anchorRow: row,
          active: false,
          frame: null,
        };
        listen();
        return;
      }

      // Arming clears the current selection, like the desktop: an empty-space
      // press with no drag is a plain "deselect".
      clearBlockSelection(view);

      drag.current = {
        kind: 'marquee',
        anchor: toContent(event.clientX, event.clientY),
        pointer: { x: event.clientX, y: event.clientY },
        anchorRow: -1,
        active: false,
        frame: null,
      };
      listen();
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
      document.body.style.userSelect = '';
      view.dom.removeAttribute('data-block-drag');
    };
  }, [view, registry, scrollRef]);

  if (!dragging) return null;
  return createPortal(
    <div ref={bandRef} className="notes-marquee pointer-events-none fixed z-[21]" style={{ visibility: 'hidden' }} />,
    document.body,
  );
}
