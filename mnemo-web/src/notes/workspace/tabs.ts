import { create } from 'zustand';

/** Which of a tab's neighbours a close verb takes with it. */
export type TabCloseScope = 'others' | 'left' | 'right';

/**
 * Which notes are open as tabs, in the order they were opened.
 *
 * A store rather than workspace state because opening a note in a new tab is an
 * action offered from the tree's row menu and the note's own menu, neither of
 * which sits under the component that renders the bar. Kept in memory only, so a
 * relaunch starts from just the note that was open rather than restoring a
 * session's worth of tabs nobody asked to keep.
 */
interface TabsState {
  ids: string[];
  /** Adds a tab if it is not already open, without changing which note is shown. */
  open: (id: string) => void;
  close: (id: string) => void;
  /** Drops a whole range in one update, so the bar never paints a half closed strip. */
  closeMany: (ids: readonly string[]) => void;
  move: (id: string, toIndex: number) => void;
}

export const useNoteTabs = create<TabsState>((set) => ({
  ids: [],
  open: (id) => set((s) => (s.ids.includes(id) ? s : { ids: [...s.ids, id] })),
  close: (id) => set((s) => ({ ids: s.ids.filter((tabId) => tabId !== id) })),
  closeMany: (ids) =>
    set((s) => {
      const gone = new Set(ids);
      const kept = s.ids.filter((tabId) => !gone.has(tabId));
      return kept.length === s.ids.length ? s : { ids: kept };
    }),
  move: (id, toIndex) =>
    set((s) => {
      const from = s.ids.indexOf(id);
      if (from === -1 || from === toIndex) return s;
      const ids = [...s.ids];
      ids.splice(from, 1);
      ids.splice(toIndex, 0, id);
      return { ids };
    }),
}));

/**
 * The ids a close verb takes down, relative to the tab it was raised on.
 *
 * Asked twice about the same range, over two different lists: the strip's own
 * ids, which is what the reader watches vanish, and the store's, which can hold
 * ids no tab is showing yet because the library has not named them. Both carry
 * the same order, and closing only the visible half would leave the rest to
 * appear as tabs the moment the library answers.
 */
export function tabsToClose(ids: readonly string[], id: string, scope: TabCloseScope): readonly string[] {
  const index = ids.indexOf(id);
  if (index === -1) return [];
  if (scope === 'others') return ids.filter((tabId) => tabId !== id);
  return scope === 'left' ? ids.slice(0, index) : ids.slice(index + 1);
}

/**
 * Where the pane lands when the tab it is on is going away: the nearest tab that
 * survives, to the right first and then to the left.
 *
 * Read off the survivors rather than off the neighbouring index, because a range
 * close usually takes the neighbours with it and stepping one place would land
 * on a note whose tab is no longer there.
 */
export function survivingNeighbour(
  ids: readonly string[],
  closing: readonly string[],
  activeId: string,
): string | null {
  const index = ids.indexOf(activeId);
  if (index === -1) return null;
  const gone = new Set(closing);
  for (let i = index + 1; i < ids.length; i += 1) if (!gone.has(ids[i])) return ids[i];
  for (let i = index - 1; i >= 0; i -= 1) if (!gone.has(ids[i])) return ids[i];
  return null;
}
