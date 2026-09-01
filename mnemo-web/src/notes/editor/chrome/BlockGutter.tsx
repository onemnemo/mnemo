import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';

import { AppIcon } from '@/components/icon/AppIcon';
import type { DragPress } from '@/lib/dnd/usePointerDrag';
import { cn } from '@/lib/utils';
import {
  Menu,
  MenuCheckItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSubMenu,
  MenuTrigger,
} from '@/components/ui/menu';
import { useT } from '@/i18n/useT';

import { deepestBlockAt } from '../pipeline/block-locate';
import { blockChildrenOf } from '../blocks/shared';
import type { BlockRegistry } from '../registry/build';
import { getBlockSelection, setBlockSelection } from '../../selection/block-selection-plugin';
import { applyGrip, gripIntent } from '../../selection/grip-selection';
import { useBlockDrag, type BlockDragHandle } from './useBlockDrag';
import { insertBlockBelow, locateBlock, type BlockLocation } from './block-commands';
import { registerBlockDragPress } from './block-drag-bridge';
import {
  blockLabel,
  blockMenuItems,
  runBlockAction,
  runBlockRequest,
  runBlockVerb,
  type BlockMenuAction,
  type BlockMenuChoice,
  type BlockMenuRequest,
  type BlockMenuVerb,
} from './block-menu-items';
import { calloutIconRequest } from './callout-icon-request';
import { chromeMinLeft, chromeRowGeometry, type ChromeRow } from './chrome-row';
import { Announcer } from './Announcer';
import { useAnnouncer } from './useAnnouncer';

/**
 * The gutter chrome for one note's blocks: a drag handle and an add-below button
 * that follow the hovered (or caret) block, plus the block action menu the handle
 * opens.
 *
 * It is one floating layer, not a widget per block. Two reasons: the top-level
 * blocks carry `content-visibility` paint containment, so anything drawn in a
 * left gutter that lived inside a block would be clipped at the block's edge;
 * and a single repositioned handle is O(1) where per-block widgets would be
 * O(blocks) against the tens-of-thousands target.
 *
 * The row is positioned rather than portalled, so it stays a child of the note's
 * pane. Only the drag ghost and the drop line go to the body, which is what lets
 * them draw over the sidebar. The marquee reads the row as page rather than
 * chrome (see `data-block-gutter` below), so the strip beside a hovered block is
 * still somewhere a block selection can start.
 *
 * The unit the handle points at is the *deepest* hovered block, not the
 * top-level one: inside a two-column row every cell child gets the handle
 * beside itself, which is what the desktop does (each EditableBlock in a column
 * carries its own grip) and what Notion does. Hovering the row's own scenery -
 * its padding, the splitter lane - offers the row itself. The menu's verbs and
 * the grip's selection act on that same unit; a drag on a nested block extracts
 * it to a top-level gap (see {@link useBlockDrag}).
 *
 * Hover is a *row*, not an element. The pointer anywhere in the band that spans
 * the document plus the margin the chrome is drawn in claims the block at that
 * height, so reaching for the buttons never means threading the pointer back
 * through the text first, and the vertical gaps between blocks hold the last
 * block rather than blanking the chrome. That is what the layer being floating
 * costs us: a per-block widget would get all of this from `:hover` on its own
 * box, but paint containment forbids one.
 *
 * The drag itself is {@link useBlockDrag}; this owns only the chrome and the menu.
 */

/** Where in the text column a lane hover probes for the block on that row. */
const PROBE_INSET = 8;

/** A row's cell, and the divider drawn between two of them. */
const COLUMN_CELL = '[data-column]';
const COLUMN_SPLITTER = '.notes-column-splitter';

/** How far past the row's own box the corridor that protects it reaches. */
const CORRIDOR_MARGIN = 4;

/** Every button in the chrome row reads the same; only the grip adds a cursor. */
const CHROME_BUTTON =
  'grid h-5 w-5 place-items-center rounded text-text-faded hover:bg-surface-subtle hover:text-text-secondary';

interface ActiveBlock {
  /** Position just before the block node, any depth. */
  pos: number;
  node: PMNode;
  /** 1 for a top-level block; deeper for a cell child. */
  depth: number;
  /** The top-level ancestor's document-child index, for the reorder. */
  topIndex: number;
  /** The block's own DOM element, kept so a scroll re-reads one rect rather than a search. */
  dom: HTMLElement;
  rect: DOMRect;
  /** The document's own left edge, for deciding whether the chrome has margin to sit in. */
  rootLeft: number;
  /** Where the free space beside the block starts: the page margin, or the previous cell's edge. */
  laneLeft: number;
  /**
   * Whether block children live inside this block's DOM. False for a leaf,
   * which lets hover skip re-resolving while the pointer crosses the leaf's
   * own inline elements; a block that can retarget to a nested child cannot.
   */
  hasNestedBlocks: boolean;
  /** The document the position was read from; a pos is only valid against its own doc. */
  doc: PMNode;
}

/** The direct child element of the editor root that an event target sits inside. O(depth), no search. */
function topLevelElement(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  let el: Node | null = target instanceof Node ? target : null;
  while (el && el.parentNode !== root) el = el.parentNode;
  return el instanceof HTMLElement && el.parentNode === root ? el : null;
}

/**
 * The document position of an element, through ProseMirror's own DOM->pos map.
 *
 * `posAtDOM` throws (or answers -1) for DOM a NodeView draws outside its
 * contentDOM - the column splitter, a checklist's box - so those fall back to
 * the top-level child the element sits inside, which always maps.
 */
function posOfElement(view: EditorView, el: Element): number | null {
  try {
    const pos = view.posAtDOM(el, 0);
    if (pos >= 0) return pos;
  } catch {
    // fall through to the top-level fallback
  }
  const top = topLevelElement(view.dom, el);
  if (!top || top === el) return null;
  try {
    const pos = view.posAtDOM(top, 0);
    return pos >= 0 ? pos : null;
  } catch {
    return null;
  }
}

/**
 * Where the free space beside a block begins.
 *
 * The page's own margin for a top-level block, and for one in a row's first
 * cell, which reaches that margin through the cell. A later cell has no margin
 * in front of it, only the previous cell, so its free space starts at that
 * cell's right edge and is the splitter lane wide. Reading nothing but the
 * space to the block's own left keeps this right at any cell count and at any
 * nesting depth, since the innermost cell is the one that bounds it.
 */
function laneLeftOf(dom: HTMLElement, rootLeft: number): number {
  const cell = dom.parentElement?.closest(COLUMN_CELL);
  if (!cell) return chromeMinLeft(rootLeft);
  // The splitter widget sits between the two cells, so the previous cell is a
  // general sibling rather than the adjacent one.
  let previous = cell.previousElementSibling;
  while (previous && !previous.matches(COLUMN_CELL)) previous = previous.previousElementSibling;
  return previous ? previous.getBoundingClientRect().right : chromeMinLeft(rootLeft);
}

/** The active-block record for the deepest block containing a document position. */
function blockFromPos(view: EditorView, registry: BlockRegistry, pos: number): ActiveBlock | null {
  const located = deepestBlockAt(view.state.doc, registry, pos);
  if (!located) return null;
  const dom = view.nodeDOM(located.pos);
  if (!(dom instanceof HTMLElement)) return null;
  const rootLeft = view.dom.getBoundingClientRect().left;
  return {
    pos: located.pos,
    node: located.node,
    depth: located.depth,
    topIndex: located.topIndex,
    dom,
    rect: dom.getBoundingClientRect(),
    rootLeft,
    laneLeft: laneLeftOf(dom, rootLeft),
    hasNestedBlocks: blockChildrenOf(located.node).length > 0,
    doc: view.state.doc,
  };
}

/** Where the row beside a block is drawn, from the measurements the record already holds. */
function rowOf(active: ActiveBlock): ChromeRow {
  return chromeRowGeometry({
    blockLeft: active.rect.left,
    rootLeft: active.rootLeft,
    laneLeft: active.laneLeft,
  });
}

/**
 * The strip a pointer crosses on its way from a block to its own row.
 *
 * Only ever claimed when the row is drawn over content: those pixels belong to
 * another block, and resolving them moves the row away from the pointer that is
 * reaching for it. A row in the page margin has nothing under it to resolve to,
 * and the lane probe there answers by height on purpose, so the corridor stays
 * out of that case entirely. It reaches no further than the row, the gap it
 * keeps off the block, and a few pixels above and below, so a pointer that
 * leaves resolves normally on its next move.
 */
function inChromeCorridor(active: ActiveBlock, x: number, y: number): boolean {
  const row = rowOf(active);
  if (!row.overContent) return false;
  if (x < row.left || x > active.rect.left) return false;
  return y >= active.rect.top - CORRIDOR_MARGIN && y <= active.rect.top + row.height + CORRIDOR_MARGIN;
}

/** The active-block record for the deepest block whose DOM contains `el`. */
function blockFromElement(view: EditorView, registry: BlockRegistry, el: Element): ActiveBlock | null {
  const pos = posOfElement(view, el);
  if (pos === null) return null;
  return blockFromPos(view, registry, pos);
}

export function BlockGutter({ view, registry }: { view: EditorView; registry: BlockRegistry }) {
  const t = useT();
  const drag = useBlockDrag(view);
  const dragging = drag.handle !== null;

  const [active, setActive] = useState<ActiveBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { message: announcement, announce } = useAnnouncer();

  // The menu is open on the block, so the chrome stays on it: the menu is
  // portalled outside the hover band and takes focus out of the editor, which
  // hover and caret would otherwise read as the block having been left.
  const pinned = menuOpen;

  const gripRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // The blocks hover and the caret point at, and the element hover last resolved,
  // so a pointer moving within one element does no work.
  const activeRef = useRef<ActiveBlock | null>(null);
  const hoveredRef = useRef<ActiveBlock | null>(null);
  const hoveredElRef = useRef<Element | null>(null);
  const caretRef = useRef<ActiveBlock | null>(null);
  const overChromeRef = useRef(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    if (dragging) return;
    // While a layer of ours is open the handle stays on its block; otherwise hover
    // wins over the caret. Re-read the chosen block's rect so a scroll keeps the
    // handle pinned to it, but keep pos/node without another lookup - unless the
    // document changed under the snapshot (a menu command, an attr write, an
    // invariant repair). Then neither half of the snapshot can be trusted: a
    // position is only meaningful against the doc it was read from, and a block
    // with no view of its own has its element rebuilt outright when an attr
    // changes, so the block is re-found by the one thing that survives, its sid.
    let chosen = pinned ? activeRef.current : (hoveredRef.current ?? caretRef.current);
    if (chosen && chosen.doc !== view.state.doc) {
      const found = locateBlock(view.state, registry, chosen.pos, String(chosen.node.attrs.sid ?? ''));
      chosen = found ? blockFromPos(view, registry, found.pos) : null;
      if (pinned) activeRef.current = chosen;
      else if (hoveredRef.current) hoveredRef.current = chosen;
      else caretRef.current = chosen;
    }
    if (!chosen || !chosen.dom.isConnected) {
      activeRef.current = null;
      setActive(null);
      return;
    }
    const rootLeft = view.dom.getBoundingClientRect().left;
    const next: ActiveBlock = {
      ...chosen,
      rect: chosen.dom.getBoundingClientRect(),
      rootLeft,
      laneLeft: laneLeftOf(chosen.dom, rootLeft),
    };
    activeRef.current = next;
    setActive(next);
  }, [dragging, pinned, view, registry]);

  // Track the hovered block, the caret block, and hover over the chrome itself.
  useEffect(() => {
    if (dragging) return;
    const root = view.dom;

    const scheduleClear = () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => {
        if (!overChromeRef.current && hoveredRef.current === null && !pinned) {
          if (!view.hasFocus()) caretRef.current = null;
          refresh();
        }
      }, 140);
    };

    const onPointerMove = (event: PointerEvent) => {
      // The chrome is drawn over the lane (and, beside a nested block, over the
      // neighbouring cell): a pointer on it stays on the block it belongs to
      // rather than retargeting to whatever it happens to cover.
      if (event.target instanceof Node && overlayRef.current?.contains(event.target)) return;
      // And the pixels between a block and a row drawn over the neighbouring
      // cell are that neighbour's, so crossing them has to keep the block whose
      // row is being reached for rather than answer with what is underneath.
      const current = activeRef.current;
      if (current && inChromeCorridor(current, event.clientX, event.clientY)) return;
      const bounds = root.getBoundingClientRect();
      const inBand =
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom &&
        event.clientX >= chromeMinLeft(bounds.left) &&
        event.clientX <= bounds.right;
      if (!inBand) {
        hoveredElRef.current = null;
        hoveredRef.current = null;
        scheduleClear();
        return;
      }
      // In the margin the row is what is hovered, so the block is read off the
      // start of the text column at the pointer's height.
      const el =
        event.clientX >= bounds.left
          ? event.target instanceof Element
            ? event.target
            : null
          : document.elementFromPoint(bounds.left + PROBE_INSET, event.clientY);
      // The gaps between blocks, and any floating chrome the probe lands on,
      // resolve to nothing; the row keeps whichever block it had. So does the
      // splitter between two cells: it is drawn by the view rather than by the
      // document, so it maps to no position of its own and resolving it falls
      // back to the row that contains it, whose first block is in the *other*
      // cell. Held here, before the cache, so it neither resolves nor becomes
      // the element a later move is compared against.
      if (!el || el === root || !root.contains(el) || el.closest(COLUMN_SPLITTER)) return;
      // A move within the same element is the common case and does nothing.
      if (el === hoveredElRef.current) return;
      hoveredElRef.current = el;
      // Crossing between a leaf block's own inline elements (a bold span, a
      // link) cannot change the target, so it skips the DOM->pos resolution -
      // which walks preceding siblings and is O(document) for a late block.
      // A block holding nested blocks has to re-resolve: the pointer may have
      // moved onto a child that is its own target.
      const hovered = hoveredRef.current;
      if (
        hovered &&
        !hovered.hasNestedBlocks &&
        hovered.doc === view.state.doc &&
        hovered.dom.isConnected &&
        hovered.dom.contains(el)
      ) {
        return;
      }
      hoveredRef.current = blockFromElement(view, registry, el);
      // Landing on the same block again (parent line to child and back) needs no
      // state churn; the rect is refreshed by the scroll listener when it moves.
      if (hovered && hoveredRef.current && hovered.pos === hoveredRef.current.pos && hovered.doc === hoveredRef.current.doc) {
        return;
      }
      refresh();
    };
    const onCaret = () => {
      caretRef.current = blockFromPos(view, registry, view.state.selection.head);
      if (hoveredRef.current === null) refresh();
    };

    // On the document, not the editor: the band reaches past the editor's own
    // box, and a pointer that leaves it has to be seen leaving.
    document.addEventListener('pointermove', onPointerMove);
    root.addEventListener('keyup', onCaret);
    root.addEventListener('mouseup', onCaret);
    root.addEventListener('focus', onCaret, true);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('keyup', onCaret);
      root.removeEventListener('mouseup', onCaret);
      root.removeEventListener('focus', onCaret, true);
      // A hover-clear armed just before a note switch would otherwise fire after
      // this component is gone and set state on the unmounted tree.
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [view, registry, dragging, pinned, refresh]);

  // Pin the ghost to the cursor the frame it appears, so it never paints at 0,0.
  useLayoutEffect(() => {
    if (dragging) drag.placeGhost();
  });

  // A scroll or resize moves the block under a shown handle; re-measure it.
  useEffect(() => {
    const onGeometry = () => refresh();
    window.addEventListener('scroll', onGeometry, true);
    window.addEventListener('resize', onGeometry);
    return () => {
      window.removeEventListener('scroll', onGeometry, true);
      window.removeEventListener('resize', onGeometry);
    };
  }, [refresh]);

  const runCommand = useCallback(
    (build: (state: EditorState, loc: BlockLocation) => Transaction | null, message: string) => {
      const current = activeRef.current;
      if (!current) return;
      const loc = locateBlock(view.state, registry, current.pos, String(current.node.attrs.sid ?? ''));
      if (!loc) return;
      const tr = build(view.state, loc);
      if (!tr) return;
      view.dispatch(tr);
      view.focus();
      // The snapshot's positions died with the old document; re-derive so the
      // next click or drag on the still-shown handle acts on the right block.
      refresh();
      announce(message);
    },
    [view, registry, announce, refresh],
  );

  const runVerb = useCallback(
    (verb: BlockMenuVerb) => {
      const current = activeRef.current;
      if (!current) return;
      const target = { pos: current.pos, sid: String(current.node.attrs.sid ?? '') };
      if (!runBlockVerb(view, registry, target, verb)) return;
      refresh();
      if (verb.announce !== null) announce(verb.announce);
    },
    [view, registry, announce, refresh],
  );

  const runAction = useCallback(
    (action: BlockMenuAction) => {
      const current = activeRef.current;
      if (!current) return;
      const target = { pos: current.pos, sid: String(current.node.attrs.sid ?? '') };
      runBlockAction(view, registry, target, action);
    },
    [view, registry],
  );

  const raise = useCallback((entry: BlockMenuRequest) => {
    const current = activeRef.current;
    if (!current) return;
    runBlockRequest({ pos: current.pos, sid: String(current.node.attrs.sid ?? '') }, entry);
  }, []);

  /**
   * What a block's own body reaches to start this drag.
   *
   * Stable across renders, reading everything it needs from a ref, so the registration is made
   * once per view rather than replaced on every hover. It resolves the handle here because the
   * registry and the translator that names a block live here; a NodeView knows only its position.
   */
  const latest = useRef({ view, registry, t, press: drag.press });
  useEffect(() => {
    latest.current = { view, registry, t, press: drag.press };
  });

  const pressFromBlock = useCallback((event: DragPress, pos: number) => {
    const { view: liveView, registry: liveRegistry, t: translate, press } = latest.current;
    const located = deepestBlockAt(liveView.state.doc, liveRegistry, pos);
    if (!located) return;
    press(event, {
      index: located.depth === 1 ? located.topIndex : null,
      pos: located.pos,
      sid: String(located.node.attrs.sid ?? ''),
      label: blockLabel(located.node, translate),
    });
  }, []);

  useEffect(() => registerBlockDragPress(view, pressFromBlock), [view, pressFromBlock]);

  const handleBlock = active;
  const handle: BlockDragHandle | null = handleBlock
    ? {
        index: handleBlock.depth === 1 ? handleBlock.topIndex : null,
        pos: handleBlock.pos,
        sid: String(handleBlock.node.attrs.sid),
        label: blockLabel(handleBlock.node, t),
      }
    : null;

  // Sibling context for the menu's disabled states; commands re-locate fresh.
  const menuLocation =
    handleBlock && menuOpen
      ? locateBlock(view.state, registry, handleBlock.pos, String(handleBlock.node.attrs.sid ?? ''))
      : null;

  const menuEntries =
    handleBlock && menuOpen
      ? blockMenuItems({ state: view.state, registry, node: handleBlock.node, location: menuLocation, t })
      : [];

  const renderVerb = (verb: BlockMenuVerb) => (
    <MenuItem
      key={verb.id}
      icon={verb.icon}
      danger={verb.danger}
      emphasis={verb.emphasis}
      disabled={verb.disabled}
      onSelect={() => runVerb(verb)}
    >
      {verb.label}
    </MenuItem>
  );

  const renderAction = (action: BlockMenuAction) =>
    action.checked === undefined ? (
      <MenuItem
        key={action.id}
        icon={action.icon}
        danger={action.danger}
        disabled={action.disabled}
        onSelect={() => runAction(action)}
      >
        {action.label}
      </MenuItem>
    ) : (
      <MenuCheckItem
        key={action.id}
        checked={action.checked}
        icon={action.icon}
        disabled={action.disabled}
        onSelect={() => runAction(action)}
      >
        {action.label}
      </MenuCheckItem>
    );

  const renderChoice = (choice: BlockMenuChoice) =>
    choice.kind === 'verb' ? renderVerb(choice) : renderAction(choice);

  // The same two buttons beside every block, in the same place, whatever the
  // block is. A block with its own affordance carries it in the document rather
  // than in this row. Beside a block whose lane is a splitter wide they stack
  // instead of sitting side by side, which is the same two buttons in the same
  // order, narrow enough to leave most of the neighbour's text showing.
  const row = handleBlock ? rowOf(handleBlock) : null;

  /**
   * Fades in, and then moves without animating.
   *
   * Two deliberate halves. The row arriving is a new thing on screen, and a thing
   * that appears instantly reads as a flicker, so it fades. The row moving from one
   * block to the next is the *same* control pointing somewhere else, and animating
   * that would put a widget gliding down the page after the pointer for the whole
   * length of a document, which is the kind of motion that makes an editor feel
   * busy rather than smooth. Repositioning instantly reads as "it was already
   * there", which is what a quiet gutter should read as.
   *
   * The animation runs on mount only, and moving between blocks does not remount,
   * so the two halves need no coordination.
   */
  const overlay = handleBlock && handle && row && !dragging ? (
    <div
      ref={overlayRef}
      // The row floats over the page margin, and the marquee starts there. The
      // two buttons answer their own presses; this marks the space around them
      // as still belonging to the page, so hovering a block never turns the
      // strip beside it into somewhere a marquee cannot begin.
      data-block-gutter
      className={cn(
        'animate-fade-in fixed z-40 flex items-center gap-0.5 rounded',
        row.stacked && 'flex-col justify-center p-px',
        row.overContent && 'bg-canvas shadow-elevation-1',
      )}
      style={{ left: row.left, top: handleBlock.rect.top, width: row.width, height: row.height }}
      onPointerEnter={() => {
        overChromeRef.current = true;
      }}
      onPointerLeave={() => {
        overChromeRef.current = false;
      }}
    >
      {/*
       * Neither button is a tab stop. This row follows the caret as much as
       * the pointer, so it is already mounted, at the caret's own block, the
       * moment a reader is simply typing; a stray Tab with nowhere else
       * assigned to it in the editor would otherwise land here first, an
       * invisible detour into editing chrome the reader never asked to reach
       * and cannot tell they are in, before the editor's own selection lets
       * go of anything. The same reason the checklist box and callout glyph
       * opt out: the pointer already reaches these two, and the grip still
       * takes real keyboard focus back on its own terms when its menu closes.
       */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('NotesEditor', 'InsertBlockBelow')}
        className={CHROME_BUTTON}
        onClick={() =>
          runCommand((state, loc) => insertBlockBelow(state, loc), t('NotesEditor', 'BlockInserted'))
        }
      >
        <AppIcon name="common/plus" size={14} />
      </button>
      <button
        ref={gripRef}
        type="button"
        tabIndex={-1}
        aria-label={t('NotesEditor', 'BlockActionsFormat', { 0: handle.label })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={cn(CHROME_BUTTON, 'cursor-grab active:cursor-grabbing')}
        onPointerDown={(event) => drag.press(event, handle)}
        onClick={(event) => {
          // Swallow the click that tails a drag; a real click acts.
          if (drag.suppressClick(handle.sid)) {
            event.preventDefault();
            return;
          }
          // The desktop's grip modifier map: plain selects the block, Ctrl/Cmd
          // toggles it, Shift ranges from the anchor, Ctrl+Shift adds the range.
          // The plain click also opens the block menu the port's grip owns -
          // select-and-menu together are Notion's reading of the same gesture.
          // The snapshot's pos is re-verified against the live document first: a
          // stale position turned into a [pos, pos+size) range would select - and
          // a following Delete would remove - whatever block sits there now.
          const intent = gripIntent(event);
          const loc = locateBlock(view.state, registry, handleBlock.pos, handle.sid);
          if (!loc) return;
          const current = getBlockSelection(view.state);
          const next = applyGrip(view.state.doc, registry, current, loc.pos, loc.node, intent);
          // The selection announcer speaks the new count; the grip stays quiet
          // so the two live regions never double up.
          if (next !== current) setBlockSelection(view, next);
          if (intent === 'select') {
            setMenuOpen((open) => !open);
            return;
          }
          view.focus();
        }}
      >
        <AppIcon name="common/grip-vertical" size={14} />
      </button>
      <Menu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) {
            refresh();
            // A row that raised a layer has handed it the focus, and taking it
            // back here would dismiss that layer in the frame it opens.
            if (calloutIconRequest() === null) {
              requestAnimationFrame(() => gripRef.current?.focus());
            }
          }
        }}
      >
        {/* An inert anchor the menu positions against, so the grip owns its own
            pointer gesture (drag vs click) instead of radix opening on press. */}
        <MenuTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-0 w-0" />
        </MenuTrigger>
        <MenuContent align="start">
          {menuEntries.map((entry) => {
            switch (entry.kind) {
              case 'separator':
                return <MenuSeparator key={entry.id} />;
              case 'submenu':
                return (
                  <MenuSubMenu key={entry.id} label={entry.label} icon={entry.icon}>
                    {entry.items.map(renderChoice)}
                  </MenuSubMenu>
                );
              case 'request':
                return (
                  <MenuItem key={entry.id} icon={entry.icon} onSelect={() => raise(entry)}>
                    {entry.label}
                  </MenuItem>
                );
              case 'verb':
                return renderVerb(entry);
              case 'action':
                return renderAction(entry);
            }
            // A new entry kind with no case above would render as undefined, which
            // React rejects with an error naming this component rather than the
            // row. The annotation makes it a build failure instead.
            const unhandled: never = entry;
            throw new Error(`[notes] no renderer for block menu entry ${JSON.stringify(unhandled)}`);
          })}
        </MenuContent>
      </Menu>
    </div>
  ) : null;

  const ghost = dragging && drag.handle ? (
    <div
      ref={drag.ghostRef}
      className="pointer-events-none fixed left-0 top-0 z-[999] flex max-w-[280px] items-center gap-2 rounded-lg border border-line bg-popover px-3 py-2 shadow-elevation-4"
    >
      <AppIcon name="common/grip-vertical" size={14} className="shrink-0 text-text-faded" />
      <span className="min-w-0 truncate text-body-extra-small font-medium text-text-primary">{drag.handle.label}</span>
    </div>
  ) : null;

  const line = dragging && drag.target ? (
    <div
      className="pointer-events-none fixed z-[998] rounded-full"
      style={{
        top: drag.target.line.top,
        left: drag.target.line.left,
        width: drag.target.line.width,
        height: drag.target.line.height,
        background: 'var(--accent)',
      }}
    />
  ) : null;

  return (
    <>
      {overlay}
      {createPortal(
        <>
          {ghost}
          {line}
        </>,
        document.body,
      )}
      <Announcer message={announcement} />
    </>
  );
}
