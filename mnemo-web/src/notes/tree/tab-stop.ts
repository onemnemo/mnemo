import { createContext } from 'react';

/** Which row of a tree is its Tab stop. Rows subscribe to their own answer, so a move re-renders two rows. */
export interface TabStopStore {
  get: () => string | null | undefined;
  set: (key: string | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createTabStopStore(initial: string | null | undefined): TabStopStore {
  let tabKey = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => tabKey,
    set: (key) => {
      if (key === tabKey) return;
      tabKey = key;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Outside a tree every row is a Tab stop. */
export const TabStopContext = createContext<TabStopStore>(createTabStopStore(undefined));
