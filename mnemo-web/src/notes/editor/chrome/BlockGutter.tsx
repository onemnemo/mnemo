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

import { topLevelBlockAt } from '../pipeline/ensure-realized';
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
 * The drag itself is {@link useBlockDrag}; this owns only the chrome and the menu.
 */

interface ActiveBlock {
  index: number;
  pos: number;
  node: PMNode;
  /** The block's own DOM element, kept so a scroll re-reads one rect rather than a search. */
  dom: HTMLElement;
  rect: DOMRect;
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
 * The active-block record for a top-level element, its index and position found
 * through ProseMirror's own DOM->pos map rather than by counting siblings, so it
 * costs O(tree depth) rather than O(document).
 */
function blockFromElement(view: EditorView, el: HTMLElement): ActiveBlock | null {
  const located = topLevelBlockAt(view, view.posAtDOM(el, 0));
  if (!located) return null;
  return { index: located.index, pos: located.pos, node: located.node, dom: el, rect: el.getBoundingClientRect() };
}

/** The active-block record for the block containing a document position. */
function blockFromPos(view: EditorView, pos: number): ActiveBlock | null {
  const located = topLevelBlockAt(view, pos);
  if (!located) return null;
  const el = view.nodeDOM(located.pos);
  if (!(el instanceof HTMLElement)) return null;
  return { index: located.index, pos: located.pos, node: located.node, dom: el, rect: el.getBoundingClientRect() };
}

export function BlockGutter({ view }: { view: EditorView }) {
  const drag = useBlockDrag(view);
  const dragging = drag.handle !== null;

  const [active, setActive] = useState<ActiveBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const gripRef = useRef<HTMLButtonElement | null>(null);
  // The blocks hover and the caret point at, and the element hover last resolved,
  // so a pointer moving within one block does no work.
  const activeRef = useRef<ActiveBlock | null>(null);
  const hoveredRef = useRef<ActiveBlock | null>(null);
  const hoveredElRef = useRef<HTMLElement | null>(null);
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
    // pinned to it, but keep index/pos/node without another lookup.
    const chosen = menuOpen ? activeRef.current : (hoveredRef.current ?? caretRef.current);
    if (!chosen || !chosen.dom.isConnected) {
      activeRef.current = null;
      setActive(null);
      return;
    }
    const next: ActiveBlock = { ...chosen, rect: chosen.dom.getBoundingClientRect() };
    activeRef.current = next;
    setActive(next);
  }, [dragging, menuOpen]);

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
      const el = topLevelElement(root, event.target);
      // A move within the same block is the common case and does nothing.
      if (el === hoveredElRef.current) return;
      hoveredElRef.current = el;
      hoveredRef.current = el ? blockFromElement(view, el) : null;
      refresh();
    };
    const onPointerLeave = () => {
      hoveredElRef.current = null;
      hoveredRef.current = null;
      scheduleClear();
    };
    const onCaret = () => {
      caretRef.current = blockFromPos(view, view.state.selection.head);
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
  }, [view, dragging, menuOpen, refresh]);

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
      const loc = locateBlock(view.state, current.index);
      if (!loc) return;
      const tr = build(view.state, loc);
      if (!tr) return;
      view.dispatch(tr);
      view.focus();
      announce(message);
    },
    [view, announce],
  );

  const handleBlock = active;
  const handle: BlockDragHandle | null = handleBlock
    ? { index: handleBlock.index, pos: handleBlock.pos, sid: String(handleBlock.node.attrs.sid), label: blockLabel(handleBlock.node) }
    : null;

  const overlay = handleBlock && handle && !dragging ? (
    <div
      className="fixed z-40 flex items-center gap-0.5"
      style={{ left: handleBlock.rect.left - 46, top: handleBlock.rect.top + 1 }}
      onPointerEnter={() => {
        overChromeRef.current = true;
      }}
      onPointerLeave={() => {
        overChromeRef.current = false;
      }}
    >
      <button
        type="button"
        aria-label="Add block below"
        className="grid h-5 w-5 place-items-center rounded text-text-faded hover:bg-surface-subtle hover:text-text-secondary"
        onClick={() => addBlockBelow(view, handleBlock)}
      >
        <AppIcon name="common/plus" size={14} />
      </button>
      <button
        ref={gripRef}
        type="button"
        aria-label={`Block actions for ${handle.label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="grid h-5 w-5 cursor-grab place-items-center rounded text-text-faded hover:bg-surface-subtle hover:text-text-secondary active:cursor-grabbing"
        onPointerDown={(event) => drag.press(event, handle)}
        onClick={(event) => {
          // Swallow the click that tails a drag; a real click toggles the menu.
          if (drag.suppressClick(handle.sid)) {
            event.preventDefault();
            return;
          }
          setMenuOpen((open) => !open);
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
            disabled={handleBlock.index <= 0}
            onSelect={() => runCommand((state, loc) => moveBlockUp(state, loc.index), 'Block moved up')}
          >
            Move up
          </MenuItem>
          <MenuItem
            icon="common/arrow-down"
            disabled={handleBlock.index >= view.state.doc.childCount - 1}
            onSelect={() => runCommand((state, loc) => moveBlockDown(state, loc.index), 'Block moved down')}
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
            disabled={view.state.doc.childCount <= 1}
            onSelect={() => runCommand((state, loc) => deleteBlock(state, loc), 'Block deleted')}
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
