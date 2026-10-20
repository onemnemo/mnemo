import { useContext, useSyncExternalStore } from 'react';

import { TabStopContext } from './tab-stop';

/** The roving tabindex. One row of a tree is the Tab stop and the arrow keys reach the rest. */
export function useTabStop(treeKey: string): 0 | -1 {
  const store = useContext(TabStopContext);
  const isStop = useSyncExternalStore(store.subscribe, () => {
    const tabKey = store.get();
    return tabKey === undefined || tabKey === treeKey;
  });
  return isStop ? 0 : -1;
}
