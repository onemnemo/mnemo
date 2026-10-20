import { useLayoutEffect, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';

import { createTabStopStore, TabStopContext } from './tab-stop';
import { treeKeyAction, type NavItem } from './tree-keys';

const ITEM = '[role="treeitem"][data-tree-key]';

function itemsOf(tree: HTMLElement): NavItem[] {
  return Array.from(tree.querySelectorAll<HTMLElement>(ITEM), (element) => {
    const expanded = element.getAttribute('aria-expanded');
    return {
      key: element.dataset.treeKey ?? '',
      depth: Number(element.dataset.rowDepth ?? 0),
      expanded: expanded === null ? undefined : expanded === 'true',
      locked: element.dataset.rowLocked === 'true',
    };
  });
}

/**
 * A `tree` with arrow-key navigation. Only keys pressed on a row itself are handled.
 * Keys typed into a field or a menu inside a row belong to that control.
 */
export function TreeNav({
  label,
  keys,
  fallbackKey,
  onToggle,
  children,
}: {
  label: string;
  /** Tree keys of the rows now shown, in order. */
  keys: readonly string[];
  /** The Tab stop before focus enters the tree: the open note's row, or the first row. */
  fallbackKey: string | null;
  onToggle: (kind: string, id: string) => void;
  children: ReactNode;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const tabKey = activeKey !== null && keys.includes(activeKey) ? activeKey : fallbackKey;
  const [store] = useState(() => createTabStopStore(tabKey));
  useLayoutEffect(() => store.set(tabKey), [store, tabKey]);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const key = (event.target as HTMLElement).dataset?.treeKey;
    if ((event.target as HTMLElement).getAttribute('role') === 'treeitem' && key) setActiveKey(key);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (target.getAttribute('role') !== 'treeitem' || !event.currentTarget.contains(target)) return;
    const action = treeKeyAction(itemsOf(event.currentTarget), target.dataset.treeKey ?? '', event.key);
    if (!action) return;
    event.preventDefault();
    if (action.type === 'focus') {
      Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEM))
        .find((element) => element.dataset.treeKey === action.key)
        ?.focus();
    } else {
      onToggle(target.dataset.rowKind ?? '', target.dataset.rowId ?? '');
    }
  };

  return (
    <TabStopContext.Provider value={store}>
      <div role="tree" aria-label={label} onFocus={onFocus} onKeyDown={onKeyDown}>
        {children}
      </div>
    </TabStopContext.Provider>
  );
}
