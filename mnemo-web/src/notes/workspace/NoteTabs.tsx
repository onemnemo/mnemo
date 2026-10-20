import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AppIcon } from '@/components/icon/AppIcon';
import { DropdownMenu } from 'radix-ui';

import { Menu, MenuContent, MenuTrigger } from '@/components/ui/menu';
import { itemClass } from '@/components/ui/menu-styles';
import { useT } from '@/i18n/useT';
import { usePointerDrag } from '@/lib/dnd/usePointerDrag';
import { useMeasuredWidth } from '@/lib/useMeasuredWidth';
import { cn } from '@/lib/utils';

import { SidebarExpandButton } from './SidebarExpandButton';
import { TabContextMenu } from './TabContextMenu';
import { tabMenuItems } from './tab-menu-items';
import { survivingNeighbour, tabsToClose, type TabCloseScope } from './tabs';

export interface NoteTab {
  readonly id: string;
  readonly title: string;
  readonly emoji: string | null;
  /** Titles of the notes above this one, topmost first. Empty for a top level note. */
  readonly parents?: readonly string[];
}

/** The glyph a tab leads with, shared by the strip and the menu. */
function TabGlyph({ tab }: { tab: NoteTab }) {
  return tab.emoji ? (
    <span aria-hidden className="w-3 shrink-0 text-center text-[12px] leading-none">{tab.emoji}</span>
  ) : (
    <AppIcon name="common/file-text" size={12} className="shrink-0 text-text-faded" preserveColors={false} />
  );
}

/** Titles shared by more than one open tab. Only those rows show their parent. */
function ambiguousTitles(tabs: readonly NoteTab[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const tab of tabs) {
    if (seen.has(tab.title)) twice.add(tab.title);
    seen.add(tab.title);
  }
  return twice;
}

/** A tab being dragged, by identity rather than index, so a refetch cannot stale it. */
interface TabHandle {
  readonly id: string;
}

/** Where a drop would land: the slot index, and where to paint the insertion line. */
interface TabTarget {
  readonly index: number;
  readonly x: number;
}

/**
 * Tabs for the editor pane. The tree stays put, so switching a tab changes the
 * one document region rather than the whole screen. The active tab lifts onto
 * the canvas colour and the rest sit back into the bar, so the state reads from
 * shape and elevation instead of a border.
 *
 * Tabs are draggable into any order. The bar is the drop surface and slots are
 * measured live off the rendered tabs, so a reorder mid-scroll still lands where
 * the insertion line says it will.
 */
export function NoteTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onCloseScope,
  onReorder,
  onExpandSidebar,
  onOpenInPeek,
  onMoveToWindow,
}: {
  tabs: readonly NoteTab[];
  activeId?: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseScope: (id: string, scope: TabCloseScope) => void;
  onReorder: (id: string, toIndex: number) => void;
  /** Present only while the tree is collapsed: the bar hosts the reopen control. */
  onExpandSidebar?: () => void;
  /** Offered only where a side panel exists to show the note in. */
  onOpenInPeek?: (id: string) => void;
  /** Offered only where the app can put a note in a window of its own. */
  onMoveToWindow?: (id: string) => void;
}) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const barRef = useRef<HTMLDivElement | null>(null);
  const ids = tabs.map((tab) => tab.id);
  const ambiguous = ambiguousTitles(tabs);

  const { ref: measureBar, width: barWidth } = useMeasuredWidth<HTMLDivElement>();
  const setBar = useCallback(
    (element: HTMLDivElement | null) => {
      barRef.current = element;
      measureBar(element);
    },
    [measureBar],
  );
  const [overflowing, setOverflowing] = useState(false);
  /** Whether tabs sit past the right edge. The edge fades while they do. */
  const [moreRight, setMoreRight] = useState(false);

  // The active tab's heavier weight and a late web font both change tab widths.
  const measureOverflow = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    setOverflowing(bar.scrollWidth > bar.clientWidth + 1);
    setMoreRight(bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1);
  }, []);

  const hasExpandButton = onExpandSidebar !== undefined;
  useLayoutEffect(measureOverflow, [measureOverflow, barWidth, tabs, activeId, hasExpandButton]);

  useEffect(() => {
    void document.fonts?.ready.then(measureOverflow);
  }, [measureOverflow]);

  // A mouse wheel scrolls the strip sideways. A trackpad's sideways swipe is left alone.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (bar.scrollWidth <= bar.clientWidth) return;
      event.preventDefault();
      bar.scrollLeft += event.deltaY;
    };
    bar.addEventListener('wheel', onWheel, { passive: false });
    return () => bar.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const active = [...(barRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])].find(
      (candidate) => candidate.dataset.tabId === activeId,
    );
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  /**
   * A menu hands focus back to the element it was raised on, which every close
   * verb may have just unmounted, and a keyboard user lands on the body with
   * nothing selected. The tab that should hold focus is claimed before the close
   * and taken up once the shorter strip has rendered.
   */
  const focusAfterClose = useRef<string | null>(null);

  useEffect(() => {
    const id = focusAfterClose.current;
    if (id === null) return;
    focusAfterClose.current = null;
    const target = [...(barRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])].find(
      (candidate) => candidate.dataset.tabId === id,
    );
    target?.focus();
  }, [tabs]);

  /** A scope closes a whole range of tabs at once; `null` closes just this one. */
  function closeVerb(id: string, scope: TabCloseScope | null): () => void {
    return () => {
      const closing = scope === null ? [id] : tabsToClose(ids, id, scope);
      focusAfterClose.current = closing.includes(id) ? survivingNeighbour(ids, closing, id) : id;
      if (scope === null) onClose(id);
      else onCloseScope(id, scope);
    };
  }

  const drag = usePointerDrag<TabHandle, TabTarget, { id: string; index: number }>({
    getKey: (handle) => handle.id,
    // Slots are read from the DOM each call: the bar scrolls, so the rects a
    // press started with are not the rects the pointer is over a moment later.
    resolve: (pointer) => {
      const bar = barRef.current;
      if (!bar) return null;
      const rects = [...bar.querySelectorAll('[data-tab-id]')].map((el) => el.getBoundingClientRect());
      if (rects.length === 0) return null;
      const barLeft = bar.getBoundingClientRect().left;
      const index = rects.findIndex((rect) => pointer.x < rect.left + rect.width / 2);
      const slot = index === -1 ? rects.length : index;
      const edge = slot === rects.length ? rects[rects.length - 1].right : rects[slot].left;
      return { index: slot, x: edge - barLeft + bar.scrollLeft };
    },
    plan: (handle, target) => {
      const from = tabs.findIndex((tab) => tab.id === handle.id);
      if (from === -1) return null;
      // A drop either side of the tab's own slot is where it already is.
      if (target.index === from || target.index === from + 1) return null;
      return { id: handle.id, index: target.index > from ? target.index - 1 : target.index };
    },
    onDrop: (plan) => onReorder(plan.id, plan.index),
    sameTarget: (a, b) => a?.index === b?.index,
    // The close button owns its own press; dragging from it would be a misfire.
    ignorePressWithin: 'button',
  });

  /**
   * Arrow-key roving focus, the standard tablist keyboard model: only the
   * active tab is a Tab stop, and the arrows both move focus and switch to
   * the tab they land on, the same immediacy a click already has. Moving
   * focus is manual because switching tabs replaces which element in the DOM
   * carries `tabIndex={0}`, so the browser's own focus-follows-Tab-order has
   * nothing to carry it there on its own.
   */
  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>, index: number): void {
    if (tabs.length === 0) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(tabs[index].id);
      return;
    }
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    const next = tabs[nextIndex];
    onSelect(next.id);
    const target = [...(barRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])].find(
      (candidate) => candidate.dataset.tabId === next.id,
    );
    target?.focus();
  }

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-divider-subtle bg-surface">
      <div
        ref={setBar}
        role="tablist"
        onScroll={measureOverflow}
        className={cn(
          // The scrollbar shows only while the pointer is over the strip.
          'scroll-thin relative flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5 [&:not(:hover)]:[scrollbar-color:transparent_transparent] [&:not(:hover)::-webkit-scrollbar-thumb]:bg-transparent',
          // The last tab fades into the menu button rather than being cut off against it.
          moreRight && '[mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]',
        )}
      >
        {onExpandSidebar ? <SidebarExpandButton onExpand={onExpandSidebar} className="mr-0.5" /> : null}

        {drag.target ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1.5 z-10 h-7 w-0.5 rounded-full bg-[var(--accent)]"
            style={{ left: drag.target.x }}
          />
        ) : null}

        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const entries = tabMenuItems({
            index,
            count: tabs.length,
            t,
            on: {
              close: closeVerb(tab.id, null),
              closeOthers: closeVerb(tab.id, 'others'),
              closeLeft: closeVerb(tab.id, 'left'),
              closeRight: closeVerb(tab.id, 'right'),
              openInPeek: onOpenInPeek && (() => onOpenInPeek(tab.id)),
              moveToWindow: onMoveToWindow && (() => onMoveToWindow(tab.id)),
            },
          });
          return (
            <TabContextMenu key={tab.id} entries={entries}>
              <div
                data-tab-id={tab.id}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onPointerDown={(event) => {
                  // Middle click closes the tab. preventDefault keeps the platform's
                  // scroll widget from opening over the note.
                  if (event.button === 1) {
                    event.preventDefault();
                    closeVerb(tab.id, null)();
                    return;
                  }
                  drag.press(event, { id: tab.id });
                }}
                onClick={() => !drag.suppressClick(tab.id) && onSelect(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                title={tab.parents?.length ? [...tab.parents, tab.title].join(' / ') : undefined}
                style={{ opacity: drag.sourceKey === tab.id ? 0.35 : undefined }}
                className={cn(
                  'group/tab flex h-7 min-w-0 max-w-[210px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg pl-2.5 pr-1 outline-none transition-colors',
                  active
                    ? 'bg-canvas text-text-primary shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_var(--line-soft)]'
                    : 'text-text-secondary hover:bg-frame-hover hover:text-text-primary focus-visible:bg-frame-hover focus-visible:text-text-primary',
                )}
              >
                <TabGlyph tab={tab} />
                <span className={cn('truncate text-[12.5px]', active ? 'font-medium' : 'font-normal')}>{tab.title}</span>
                <button
                  type="button"
                  aria-label={nt('CloseTabFormat', { 0: tab.title })}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-md text-text-faded hover:bg-frame-active hover:text-text-primary',
                    active ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
                  )}
                >
                  <AppIcon name="common/x" size={12} />
                </button>
              </div>
            </TabContextMenu>
          );
        })}
      </div>
      {/* Always there, so the button appearing cannot change whether the strip overflows. */}
      <div className="grid size-8 shrink-0 place-items-center">
        {overflowing ? (
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                aria-label={nt('OpenTabsMenu')}
                title={nt('OpenTabsMenu')}
                className="grid size-6 place-items-center rounded-md text-text-faded outline-none transition-colors hover:bg-frame-hover hover:text-text-primary focus-visible:bg-frame-hover"
              >
                <AppIcon name="common/chevron-down" size={14} />
              </button>
            </MenuTrigger>
            <MenuContent
              align="end"
              className="max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-[320px] overflow-y-auto"
            >
              {tabs.map((tab) => {
                const active = tab.id === activeId;
                const parent = ambiguous.has(tab.title) ? tab.parents?.[tab.parents.length - 1] : undefined;
                return (
                  <DropdownMenu.Item
                    key={tab.id}
                    onSelect={() => onSelect(tab.id)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(itemClass(), 'group/row gap-2 pr-1', active && 'bg-surface-subtle font-medium text-foreground')}
                  >
                    <TabGlyph tab={tab} />
                    <span className="min-w-0 flex-1 truncate">
                      {tab.title}
                      {parent !== undefined ? <span className="ml-1.5 font-normal text-text-faded">{parent}</span> : null}
                    </span>
                    <button
                      type="button"
                      aria-label={nt('CloseTabFormat', { 0: tab.title })}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeVerb(tab.id, null)();
                      }}
                      className="grid size-5 shrink-0 place-items-center rounded-md text-text-faded opacity-0 hover:bg-frame-active hover:text-text-primary group-hover/row:opacity-100 group-data-[highlighted]/row:opacity-100"
                    >
                      <AppIcon name="common/x" size={12} />
                    </button>
                  </DropdownMenu.Item>
                );
              })}
            </MenuContent>
          </Menu>
        ) : null}
      </div>
    </div>
  );
}
