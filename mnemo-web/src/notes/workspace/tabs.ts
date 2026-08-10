import { create } from 'zustand';

/**
 * Which notes are open as tabs, in the order they were opened.
 *
 * A store rather than workspace state because opening a note in a new tab is an
 * action offered from the tree's row menu and the note's own menu, neither of
 * which sits under the component that renders the bar. Kept in memory only, like
 * the tree's expansion, so a reload starts from just the open note rather than
 * restoring a session's worth of tabs nobody asked to keep.
 */
interface TabsState {
  ids: string[];
  /** Adds a tab if it is not already open, without changing which note is shown. */
  open: (id: string) => void;
  close: (id: string) => void;
  move: (id: string, toIndex: number) => void;
}

export const useNoteTabs = create<TabsState>((set) => ({
  ids: [],
  open: (id) => set((s) => (s.ids.includes(id) ? s : { ids: [...s.ids, id] })),
  close: (id) => set((s) => ({ ids: s.ids.filter((tabId) => tabId !== id) })),
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
