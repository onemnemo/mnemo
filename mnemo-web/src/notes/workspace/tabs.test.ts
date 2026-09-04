/**
 * The arithmetic behind the close verbs.
 *
 * Two lists carry the same tabs: the strip renders only the open ids the library
 * has named, so the store can hold more than the reader can see. Both the range
 * a verb takes down and the note the pane lands on afterwards are worked out
 * here, away from the component, because the answer that looks right for closing
 * one tab is wrong for closing a row of them.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { survivingNeighbour, tabsToClose, useNoteTabs } from './tabs';

const strip = ['a', 'b', 'c', 'd', 'e'];

describe('the range a close verb takes down', () => {
  it('leaves only the tab it was raised on when closing the others', () => {
    expect(tabsToClose(strip, 'c', 'others')).toEqual(['a', 'b', 'd', 'e']);
  });

  it('takes everything on the named side', () => {
    expect(tabsToClose(strip, 'c', 'left')).toEqual(['a', 'b']);
    expect(tabsToClose(strip, 'c', 'right')).toEqual(['d', 'e']);
  });

  it('takes nothing when the side is empty', () => {
    expect(tabsToClose(strip, 'a', 'left')).toEqual([]);
    expect(tabsToClose(strip, 'e', 'right')).toEqual([]);
    expect(tabsToClose(['a'], 'a', 'others')).toEqual([]);
  });

  it('takes nothing for a tab the list does not hold', () => {
    expect(tabsToClose(strip, 'z', 'others')).toEqual([]);
    expect(tabsToClose(strip, 'z', 'left')).toEqual([]);
  });

  it('answers the same range over a longer list, which is how the unseen ids go too', () => {
    // 'x' is open but has no tab yet, and it sits inside the range the reader
    // asked for, so it has to go with the rest or it appears as a tab later.
    const open = ['a', 'x', 'b', 'c', 'd'];
    expect(tabsToClose(open, 'c', 'left')).toEqual(['a', 'x', 'b']);
    expect(tabsToClose(open, 'c', 'others')).toEqual(['a', 'x', 'b', 'd']);
  });
});

describe('where the pane lands when its own tab is closed', () => {
  it('steps to the right, and only falls left when nothing is there', () => {
    expect(survivingNeighbour(strip, ['c'], 'c')).toBe('d');
    expect(survivingNeighbour(strip, ['e'], 'e')).toBe('d');
  });

  it('skips the tabs that are going too rather than landing on one of them', () => {
    // Closing everything but 'a' from a pane sitting on 'c': stepping one place
    // to 'd' would open a note whose tab is on its way out.
    expect(survivingNeighbour(strip, tabsToClose(strip, 'a', 'others'), 'c')).toBe('a');
  });

  it('lands on the tab the menu was raised on when the others go, wherever it sits', () => {
    // The pane is on 'a', which is one of the others, so every one of these
    // closes the note that is open.
    for (const anchor of ['b', 'c', 'd', 'e']) {
      expect(survivingNeighbour(strip, tabsToClose(strip, anchor, 'others'), 'a')).toBe(anchor);
    }
  });

  it('lands on the anchor from either side of a one sided close', () => {
    expect(survivingNeighbour(strip, tabsToClose(strip, 'c', 'left'), 'a')).toBe('c');
    expect(survivingNeighbour(strip, tabsToClose(strip, 'c', 'right'), 'e')).toBe('c');
  });

  it('has nowhere to land when the whole strip goes', () => {
    expect(survivingNeighbour(strip, strip, 'c')).toBeNull();
    expect(survivingNeighbour(strip, [], 'z')).toBeNull();
  });
});

describe('the open tabs store', () => {
  beforeEach(() => {
    useNoteTabs.setState({ ids: [] });
  });

  it('drops a whole range in one update', () => {
    useNoteTabs.setState({ ids: ['a', 'b', 'c', 'd'] });
    useNoteTabs.getState().closeMany(['a', 'c']);
    expect(useNoteTabs.getState().ids).toEqual(['b', 'd']);
  });

  it('drops the ids no tab was showing, so they cannot come back as tabs', () => {
    const open = ['a', 'x', 'b', 'c'];
    useNoteTabs.setState({ ids: open });
    useNoteTabs.getState().closeMany(tabsToClose(open, 'c', 'left'));
    expect(useNoteTabs.getState().ids).toEqual(['c']);
  });

  it('keeps the same array when the range names nothing it holds', () => {
    useNoteTabs.setState({ ids: ['a', 'b'] });
    const before = useNoteTabs.getState().ids;
    useNoteTabs.getState().closeMany(['z']);
    expect(useNoteTabs.getState().ids).toBe(before);
  });
});
