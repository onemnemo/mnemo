import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

import { AppIcon } from '@/components/icon/AppIcon';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSubMenu,
  MenuTrigger,
} from '@/components/ui/menu';

import { deepestBlockAt } from '../pipeline/block-locate';
import { blockChildrenOf } from '../blocks/shared';
import type { BlockRegistry } from '../registry/build';
import { getBlockSelection, setBlockSelection } from '../../selection/block-selection-plugin';
import { buildDeleteSelected } from '../../selection/delete-selected';
import { applyGrip, gripIntent } from '../../selection/grip-selection';
import { sidsWithin } from '../../selection/block-selection';
import { useBlockDrag, type BlockDragHandle } from './useBlockDrag';
import {
  canTurnInto,
  deleteBlock,
  duplicateBlock,
  isCurrentType,
  locateBlock,
  moveBlockDown,
  moveBlockUp,
  turnInto,
  TURN_INTO_OPTIONS,
  type BlockLocation,
} from './block-commands';

/**
 * The gutter chrome for one note's blocks: a drag handle and an add-below button
 * that follow the hovered (or caret) block, plus the block action menu the handle
 * opens.
 *
 * It is one floating layer portalled to the body, not a widget per block. Two
 * reasons: the top-level blocks carry `content-visibility` paint containment, so
 * anything drawn in a left gutter that lived inside a block would be clipped at
 * the block's edge; and a single repositioned handle is O(1) where per-block
 * widgets would be O(blocks) against the tens-of-thousands target.
 *
 * The unit the handle points at is the *deepest* hovered block, not the
 * top-level one: inside a two-column row every cell child gets the handle
 * beside itself, which is what the desktop does (each EditableBlock in a column
 * carries its own grip) and what Notion does. Hovering the row's own scenery -
 * its padding, the splitter lane - offers the row itself. The menu's verbs and
 * the grip's selection act on that same unit; a drag on a nested block extracts
 * it to a top-level gap (see {@link useBlockDrag}).
 *
 * The drag itself is {@link useBlockDrag}; this owns only the chrome and the menu.
 */

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
  /**
   * Whether block children live inside this block's DOM. False for a leaf,
   * which lets hover skip re-resolving while the pointer crosses the leaf's
   * own inline elements; a block that can retarget to a nested child cannot.
   */
  hasNestedBlocks: boolean;
  /** The document the position was read from; a pos is only valid against its own doc. */
  doc: PMNode;
}

function blockLabel(node: PMNode): string {
  const name = node.type.name;
  if (name === 'heading') return `Heading ${String(node.attrs.level ?? 1)}`;
  const labels: Record<string, string> = {
    paragraph: 'Text',
    quote: 'Quote',
    bulletItem: 'Bulleted list',
    numberedItem: 'Numbered list',
    checklistItem: 'Checklist',
    codeBlock: 'Code',
    divider: 'Divider',
    image: 'Image',
    equationBlock: 'Equation',
    twoColumn: 'Columns',
    columnGroup: 'Columns',
    page: 'Page',
    sketch: 'Sketch',
  };
  return labels[name] ?? 'Block';
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

/** The active-block record for the deepest block containing a document position. */
function blockFromPos(view: EditorView, registry: BlockRegistry, pos: number): ActiveBlock | null {
  const located = deepestBlockAt(view.state.doc, registry, pos);
  if (!located) return null;
  const dom = view.nodeDOM(located.pos);
  if (!(dom instanceof HTMLElement)) return null;
  return {
    pos: located.pos,
    node: located.node,
    depth: located.depth,
    topIndex: located.topIndex,
    dom,
    rect: dom.getBoundingClientRect(),
    hasNestedBlocks: blockChildrenOf(located.node).length > 0,
    doc: view.state.doc,
  };
}

/** The active-block record for the deepest block whose DOM contains `el`. */
function blockFromElement(view: EditorView, registry: BlockRegistry, el: Element): ActiveBlock | null {
  const pos = posOfElement(view, el);
  if (pos === null) return null;
  return blockFromPos(view, registry, pos);
}

export function BlockGutter({ view, registry }: { view: EditorView; registry: BlockRegistry }) {
  const drag = useBlockDrag(view);
  const dragging = drag.handle !== null;

  const [active, setActive] = useState<ActiveBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const gripRef = useRef<HTMLButtonElement | null>(null);
  // The blocks hover and the caret point at, and the element hover last resolved,
  // so a pointer moving within one element does no work.
  const activeRef = useRef<ActiveBlock | null>(null);
  const hoveredRef = useRef<ActiveBlock | null>(null);
  const hoveredElRef = useRef<Element | null>(null);
  const caretRef = useRef<ActiveBlock | null>(null);
  const overChromeRef = useRef(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((message: string) => {
    // Re-set even to the same text so a repeated action still speaks: a trailing
    // space forces a new string the screen reader treats as a fresh announcement.
    setAnnouncement((prev) => (prev === message ? `${message} ` : message));
  }, []);

  const refresh = useCallback(() => {
    if (dragging) return;
    // While the menu is open the handle stays on its block; otherwise hover wins
    // over the caret. Re-read the chosen block's rect so a scroll keeps the handle
    // pinned to it, but keep pos/node without another lookup - unless the document
    // changed under the snapshot (a menu command, an invariant repair): a position
    // is only meaningful against the doc it was read from, so it is re-derived
    // from the element, which ProseMirror keeps mapped to the current doc.
    let chosen = menuOpen ? activeRef.current : (hoveredRef.current ?? caretRef.current);
    if (chosen && chosen.dom.isConnected && chosen.doc !== view.state.doc) {
      chosen = blockFromElement(view, registry, chosen.dom);
      if (menuOpen) activeRef.current = chosen;
      else if (hoveredRef.current) hoveredRef.current = chosen;
      else caretRef.current = chosen;
    }
    if (!chosen || !chosen.dom.isConnected) {
      activeRef.current = null;
      setActive(null);
      return;
    }
    const next: ActiveBlock = { ...chosen, rect: chosen.dom.getBoundingClientRect() };
    activeRef.current = next;
    setActive(next);
  }, [dragging, menuOpen, view, registry]);

  // Track the hovered block, the caret block, and hover over the chrome itself.
  useEffect(() => {
    if (dragging) return;
    const root = view.dom;

    const scheduleClear = () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => {
        if (!overChromeRef.current && hoveredRef.current === null && !menuOpen) {
          if (!view.hasFocus()) caretRef.current = null;
          refresh();
        }
      }, 140);
    };

    const onPointerMove = (event: PointerEvent) => {
      const el = event.target instanceof Element ? event.target : null;
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
        el &&
        hovered.dom.isConnected &&
        hovered.dom.contains(el)
      ) {
        return;
      }
      hoveredRef.current = el && el !== root ? blockFromElement(view, registry, el) : null;
      // Landing on the same block again (parent line to child and back) needs no
      // state churn; the rect is refreshed by the scroll listener when it moves.
      if (hovered && hoveredRef.current && hovered.pos === hoveredRef.current.pos && hovered.doc === hoveredRef.current.doc) {
        return;
      }
      refresh();
    };
    const onPointerLeave = () => {
      hoveredElRef.current = null;
      hoveredRef.current = null;
      scheduleClear();
    };
    const onCaret = () => {
      caretRef.current = blockFromPos(view, registry, view.state.selection.head);
      if (hoveredRef.current === null) refresh();
    };

    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerleave', onPointerLeave);
    root.addEventListener('keyup', onCaret);
    root.addEventListener('mouseup', onCaret);
    root.addEventListener('focus', onCaret, true);
    return () => {
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onPointerLeave);
      root.removeEventListener('keyup', onCaret);
      root.removeEventListener('mouseup', onCaret);
      root.removeEventListener('focus', onCaret, true);
      // A hover-clear armed just before a note switch would otherwise fire after
      // this component is gone and set state on the unmounted tree.
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [view, registry, dragging, menuOpen, refresh]);

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

  const handleBlock = active;
  const handle: BlockDragHandle | null = handleBlock
    ? {
        index: handleBlock.depth === 1 ? handleBlock.topIndex : null,
        pos: handleBlock.pos,
        sid: String(handleBlock.node.attrs.sid),
        label: blockLabel(handleBlock.node),
      }
    : null;

  // Sibling context for the menu's disabled states; commands re-locate fresh.
  const menuLocation =
    handleBlock && menuOpen
      ? locateBlock(view.state, registry, handleBlock.pos, String(handleBlock.node.attrs.sid ?? ''))
      : null;

  // Inside a column the -46 gutter would land on the neighbouring cell's text,
  // so a nested block gets compact chrome: the grip alone, tucked into the
  // narrow lane just left of the block. The desktop's cells made the same
  // trade, collapsing the add gutter and keeping the handle.
  const nested = (handleBlock?.depth ?? 1) > 1;

  const overlay = handleBlock && handle && !dragging ? (
    <div
      className="fixed z-40 flex items-center gap-0.5"
      style={{ left: handleBlock.rect.left - (nested ? 24 : 46), top: handleBlock.rect.top + 1 }}
      onPointerEnter={() => {
        overChromeRef.current = true;
      }}
      onPointerLeave={() => {
        overChromeRef.current = false;
      }}
    >
      {nested ? null : (
        <button
          type="button"
          aria-label="Add block below"
          className="grid h-5 w-5 place-items-center rounded text-text-faded hover:bg-surface-subtle hover:text-text-secondary"
          onClick={() => addBlockBelow(view, handleBlock)}
        >
          <AppIcon name="common/plus" size={14} />
        </button>
      )}
      <button
        ref={gripRef}
        type="button"
        aria-label={`Block actions for ${handle.label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="grid h-5 w-5 cursor-grab place-items-center rounded text-text-faded hover:bg-surface-subtle hover:text-text-secondary active:cursor-grabbing"
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
            requestAnimationFrame(() => gripRef.current?.focus());
          }
        }}
      >
        {/* An inert anchor the menu positions against, so the grip owns its own
            pointer gesture (drag vs click) instead of radix opening on press. */}
        <MenuTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-0 w-0" />
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem
            icon="common/arrow-up"
            disabled={!menuLocation?.prev}
            onSelect={() => runCommand((state, loc) => moveBlockUp(state, loc), 'Block moved up')}
          >
            Move up
          </MenuItem>
          <MenuItem
            icon="common/arrow-down"
            disabled={!menuLocation?.next}
            onSelect={() => runCommand((state, loc) => moveBlockDown(state, loc), 'Block moved down')}
          >
            Move down
          </MenuItem>
          <MenuItem icon="common/copy" onSelect={() => runCommand((state, loc) => duplicateBlock(state, loc), 'Block duplicated')}>
            Duplicate
          </MenuItem>
          {canTurnInto(handleBlock.node) ? (
            <MenuSubMenu label="Turn into" icon="common/file-text">
              {TURN_INTO_OPTIONS.map((option) => (
                <MenuItem
                  key={option.id}
                  emphasis={isCurrentType(handleBlock.node, option)}
                  onSelect={() => runCommand((state, loc) => turnInto(state, loc, option), `Turned into ${option.label}`)}
                >
                  {option.label}
                </MenuItem>
              ))}
            </MenuSubMenu>
          ) : null}
          <MenuSeparator />
          <MenuItem
            icon="common/trash"
            danger
            disabled={
              (menuLocation?.parentPos ?? 0) < 0 &&
              view.state.doc.childCount <= 1 &&
              getBlockSelection(view.state).selected.size === 0
            }
            onSelect={() => {
              // When this block is part of a live multi-block selection, Delete
              // removes the whole selection; otherwise it removes just this block.
              // Located fresh: the snapshot's pos may predate a menu command.
              const selection = getBlockSelection(view.state);
              const loc = locateBlock(view.state, registry, handleBlock.pos, String(handleBlock.node.attrs.sid ?? ''));
              if (!loc) return;
              const leaves = sidsWithin(view.state.doc, registry, loc.pos, loc.node);
              const inSelection = selection.selected.size > 0 && leaves.some((sid) => selection.selected.has(sid));
              if (inSelection) {
                // The selection announcer speaks the clear that follows; deleting
                // the whole selection here would double the live region.
                const tr = buildDeleteSelected(view.state, registry, selection.selected);
                if (tr) {
                  view.dispatch(tr);
                  view.focus();
                }
                return;
              }
              runCommand((state, loc) => deleteBlock(state, loc), 'Block deleted');
            }}
          >
            Delete
          </MenuItem>
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

/** Off-screen live region so a menu or keyboard action is spoken. */
function Announcer({ message }: { message: string }) {
  return (
    <div aria-live="polite" role="status" className="sr-only">
      {message}
    </div>
  );
}

/** Insert an empty paragraph after the block and drop the caret into it. */
function addBlockBelow(view: EditorView, block: ActiveBlock) {
  const paragraph = view.state.schema.nodes.paragraph;
  const filled = paragraph.createAndFill();
  if (!filled) return;
  const at = block.pos + block.node.nodeSize;
  const tr = view.state.tr.insert(at, filled);
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
  view.dispatch(tr);
  view.focus();
}
