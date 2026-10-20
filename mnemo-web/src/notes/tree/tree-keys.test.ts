import { describe, expect, it } from 'vitest';

import { treeKeyAction, type NavItem } from './tree-keys';

const items: NavItem[] = [
  { key: 'folder:f', depth: 0, expanded: true },
  { key: 'note:p', depth: 1, expanded: false },
  { key: 'note:q', depth: 1, expanded: true },
  { key: 'note:c', depth: 2 },
  { key: 'note:z', depth: 0 },
];

const press = (from: string, key: string) => treeKeyAction(items, from, key);

describe('treeKeyAction', () => {
  it('walks the visible rows with Up and Down and stops at the ends', () => {
    expect(press('note:p', 'ArrowDown')).toEqual({ type: 'focus', key: 'note:q' });
    expect(press('note:p', 'ArrowUp')).toEqual({ type: 'focus', key: 'folder:f' });
    expect(press('folder:f', 'ArrowUp')).toBeNull();
    expect(press('note:z', 'ArrowDown')).toBeNull();
  });

  it('jumps to the first and last row with Home and End', () => {
    expect(press('note:q', 'Home')).toEqual({ type: 'focus', key: 'folder:f' });
    expect(press('note:q', 'End')).toEqual({ type: 'focus', key: 'note:z' });
  });

  it('opens a closed row with Right and steps into an open one', () => {
    expect(press('note:p', 'ArrowRight')).toEqual({ type: 'toggle', key: 'note:p' });
    expect(press('note:q', 'ArrowRight')).toEqual({ type: 'focus', key: 'note:c' });
    expect(press('note:c', 'ArrowRight')).toBeNull();
  });

  it('does not step into the row after an open row that has no children shown', () => {
    const lone: NavItem[] = [
      { key: 'a', depth: 0, expanded: true },
      { key: 'b', depth: 0 },
    ];
    expect(treeKeyAction(lone, 'a', 'ArrowRight')).toBeNull();
  });

  it('closes an open row with Left and steps out to the parent from anywhere else', () => {
    expect(press('note:q', 'ArrowLeft')).toEqual({ type: 'toggle', key: 'note:q' });
    expect(press('note:c', 'ArrowLeft')).toEqual({ type: 'focus', key: 'note:q' });
    expect(press('note:p', 'ArrowLeft')).toEqual({ type: 'focus', key: 'folder:f' });
    expect(press('note:z', 'ArrowLeft')).toBeNull();
  });

  it('leaves other keys and unknown rows alone', () => {
    expect(press('note:p', 'a')).toBeNull();
    expect(press('note:p', 'Enter')).toBeNull();
    expect(press('missing', 'ArrowDown')).toBeNull();
  });

  it('steps into a locked open row with Right and out to the parent with Left, never closing it', () => {
    const held: NavItem[] = [
      { key: 'p', depth: 0, expanded: true, locked: true },
      { key: 'c', depth: 1 },
    ];
    expect(treeKeyAction(held, 'p', 'ArrowRight')).toEqual({ type: 'focus', key: 'c' });
    expect(treeKeyAction(held, 'p', 'ArrowLeft')).toBeNull();
    expect(treeKeyAction(held, 'c', 'ArrowLeft')).toEqual({ type: 'focus', key: 'p' });
  });
});
