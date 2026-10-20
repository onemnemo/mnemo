/** A visible row of a tree, as the keyboard sees it. */
export interface NavItem {
  key: string;
  depth: number;
  /** Absent on a row that cannot open or close. */
  expanded?: boolean;
  /** Open and locked. The row can be stepped into but not closed. */
  locked?: boolean;
}

export type TreeKeyAction = { type: 'focus'; key: string } | { type: 'toggle'; key: string };

/** What a key does to a tree, following the WAI-ARIA tree pattern. Null for a key the tree ignores. */
export function treeKeyAction(items: readonly NavItem[], currentKey: string, pressed: string): TreeKeyAction | null {
  const index = items.findIndex((item) => item.key === currentKey);
  if (index < 0 || items.length === 0) return null;
  const current = items[index];
  const focus = (target: NavItem | undefined): TreeKeyAction | null =>
    target ? { type: 'focus', key: target.key } : null;

  switch (pressed) {
    case 'ArrowDown':
      return focus(items[index + 1]);
    case 'ArrowUp':
      return focus(items[index - 1]);
    case 'Home':
      return focus(items[0]);
    case 'End':
      return focus(items[items.length - 1]);
    case 'ArrowRight': {
      if (current.expanded === false) return { type: 'toggle', key: current.key };
      const next = items[index + 1];
      return current.expanded && next && next.depth > current.depth ? focus(next) : null;
    }
    case 'ArrowLeft': {
      if (current.expanded && !current.locked) return { type: 'toggle', key: current.key };
      for (let i = index - 1; i >= 0; i--) if (items[i].depth < current.depth) return focus(items[i]);
      return null;
    }
    default:
      return null;
  }
}
