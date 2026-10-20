// @vitest-environment jsdom

/**
 * Keyboard use of the real rows inside the real tree. The harness owns the expansion
 * sets as the workspace does, so each arrow key is checked across a re-render.
 */

import { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import { NoteTreeRows } from './NoteTreeRows';
import { TreeNav } from './TreeNav';
import { buildNoteTree, hierarchyOf, treeKeyOf } from './tree-model';
import type { TreeDrag } from './useNoteTreeDrag';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), updateNote: vi.fn(async () => {}) }));

vi.mock('../api', () => ({
  useSaveNoteFolder: () => ({ mutateAsync: vi.fn() }),
  useDeleteNoteFolder: () => ({ mutateAsync: vi.fn() }),
  useCreateNote: () => ({ mutateAsync: vi.fn() }),
  useUpdateNoteMetadata: () => ({ mutateAsync: mocks.updateNote }),
  useDeleteNote: () => ({ mutateAsync: vi.fn() }),
  useDuplicateNote: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/router', () => ({ navigate: mocks.navigate }));
vi.mock('@/i18n/useT', () => ({ useT: () => (_ns: string, key: string) => key }));
vi.mock('@/trash/undo', () => ({ useUndoDelete: () => vi.fn() }));
vi.mock('../transfer/store', () => ({
  useNoteTransfer: (select: (state: { open: unknown }) => unknown) => select({ open: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function note(id: string, over: Partial<NoteSummaryDto> = {}): NoteSummaryDto {
  return {
    id,
    sid: id,
    ver: 1,
    title: id,
    folderId: null,
    parentNoteId: null,
    order: 0,
    isFavorite: false,
    emoji: null,
    cover: null,
    coverCrop: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const folders: NoteFolderDto[] = [{ id: 'f', name: 'Folder', parentId: null, order: 0 }];
const notes = [
  note('p', { folderId: 'f', order: 0 }),
  note('c1', { folderId: 'f', parentNoteId: 'p', order: 0 }),
  note('c2', { folderId: 'f', parentNoteId: 'p', order: 1 }),
  note('z', { folderId: 'f', order: 1 }),
];

const drag = {
  sourceKey: null,
  handle: null,
  target: null,
  ghostRef: { current: null },
  placeGhost: () => {},
  press: vi.fn(),
  suppressClick: () => false,
} as unknown as TreeDrag;

function Harness({ selected, search = '' }: { selected?: string; search?: string }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const flip = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const toggleFolder = (id: string) => setCollapsed((prev) => flip(prev, id));
  const toggleNote = (id: string) => setExpanded((prev) => flip(prev, id));
  const tree = buildNoteTree({
    folders,
    notes,
    hierarchy: hierarchyOf(notes, folders),
    search,
    collapsed,
    expandedNotes: expanded,
  });
  const keys = tree.rows.map(treeKeyOf);
  return (
    <TreeNav
      label="My notes"
      keys={keys}
      fallbackKey={selected && keys.includes(`note:${selected}`) ? `note:${selected}` : (keys[0] ?? null)}
      onToggle={(kind, id) => (kind === 'folder' ? toggleFolder(id) : toggleNote(id))}
    >
      <NoteTreeRows
        rows={tree.rows}
        selectedNoteId={selected}
        drag={drag}
        onToggleFolder={toggleFolder}
        onToggleNote={toggleNote}
        onExport={() => {}}
      />
    </TreeNav>
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (selected?: string, search?: string) =>
  act(() => root.render(<StrictMode><Harness selected={selected} search={search} /></StrictMode>));
const item = (key: string) => container.querySelector<HTMLElement>(`[data-tree-key="${key}"]`)!;
const labels = () => [...container.querySelectorAll('[role="treeitem"]')].map((el) => (el as HTMLElement).dataset.treeKey);
const tabStops = () => [...container.querySelectorAll('[role="treeitem"]')].filter((el) => el.getAttribute('tabindex') === '0');

function press(key: string, target: Element = document.activeElement!) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('the notes tree', () => {
  it('is one tree with one tab stop and a level on every row', () => {
    mount();
    expect(container.querySelectorAll('[role="tree"]')).toHaveLength(1);
    expect(tabStops().map((el) => (el as HTMLElement).dataset.treeKey)).toEqual(['folder:f']);
    expect(item('folder:f').getAttribute('aria-level')).toBe('1');
    expect(item('note:p').getAttribute('aria-level')).toBe('2');
    expect(item('note:p').getAttribute('aria-expanded')).toBe('false');
    expect(item('note:z').hasAttribute('aria-expanded')).toBe(false);
  });

  it('starts the tab stop on the open note when its row is showing', () => {
    mount('z');
    expect(tabStops().map((el) => (el as HTMLElement).dataset.treeKey)).toEqual(['note:z']);
  });

  it('opens a row with Right, steps into it, and returns to its parent with Left', () => {
    mount();
    act(() => item('note:p').focus());
    press('ArrowRight');
    expect(labels()).toEqual(['folder:f', 'note:p', 'note:c1', 'note:c2', 'note:z']);
    expect(item('note:p').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(2);

    press('ArrowRight');
    expect(document.activeElement).toBe(item('note:c1'));
    expect(item('note:c1').getAttribute('aria-level')).toBe('3');
    expect(tabStops().map((el) => (el as HTMLElement).dataset.treeKey)).toEqual(['note:c1']);

    press('ArrowLeft');
    expect(document.activeElement).toBe(item('note:p'));
    press('ArrowLeft');
    expect(labels()).toEqual(['folder:f', 'note:p', 'note:z']);
  });

  it('walks rows with Up and Down and jumps with Home and End', () => {
    mount();
    act(() => item('folder:f').focus());
    press('ArrowDown');
    expect(document.activeElement).toBe(item('note:p'));
    press('End');
    expect(document.activeElement).toBe(item('note:z'));
    press('ArrowUp');
    expect(document.activeElement).toBe(item('note:p'));
    press('Home');
    expect(document.activeElement).toBe(item('folder:f'));
  });

  it('closes and opens a folder from the keyboard', () => {
    mount();
    act(() => item('folder:f').focus());
    press('ArrowLeft');
    expect(labels()).toEqual(['folder:f']);
    press('ArrowRight');
    expect(labels()).toEqual(['folder:f', 'note:p', 'note:z']);
  });

  it('keeps a tab stop when the focused row is folded away with the mouse', () => {
    mount();
    act(() => item('note:p').focus());
    press('ArrowRight');
    act(() => item('note:c2').focus());
    act(() => item('note:p').querySelector<HTMLElement>('[title="CollapseChildren"]')!.click());
    expect(labels()).toEqual(['folder:f', 'note:p', 'note:z']);
    expect(tabStops().map((el) => (el as HTMLElement).dataset.treeKey)).toEqual(['folder:f']);
  });

  it('opens the focused note on Enter', () => {
    mount();
    act(() => item('note:z').focus());
    press('Enter');
    expect(mocks.navigate).toHaveBeenCalledWith('notes', 'z');
  });

  it('leaves arrow keys typed into a rename field to the field', () => {
    mount();
    act(() => item('note:z').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const input = container.querySelector<HTMLInputElement>('input')!;
    expect(input).not.toBeNull();
    act(() => input.focus());
    press('ArrowUp', input);
    press('Home', input);
    expect(document.activeElement).toBe(input);
  });

  it('draws a child page row that cannot be dragged', () => {
    mount();
    act(() => item('note:p').focus());
    press('ArrowRight');
    const child = item('note:c1');
    expect(child.dataset.rowKind).toBe('child');
    act(() => child.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(drag.press).not.toHaveBeenCalled();
    act(() => item('note:z').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(drag.press).toHaveBeenCalledTimes(1);
  });

  it('opens a child page when its row is clicked', () => {
    mount();
    act(() => item('note:p').focus());
    press('ArrowRight');
    act(() => item('note:c2').click());
    expect(mocks.navigate).toHaveBeenCalledWith('notes', 'c2');
  });

  it('steps into a parent shown with its matches during a search and never folds it', () => {
    mount(undefined, 'c');
    expect(labels()).toEqual(['note:p', 'note:c1', 'note:c2']);
    const parent = item('note:p');
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    act(() => parent.focus());
    press('ArrowRight');
    expect(document.activeElement).toBe(item('note:c1'));
    press('ArrowLeft');
    expect(document.activeElement).toBe(parent);
    press('ArrowLeft');
    expect(labels()).toEqual(['note:p', 'note:c1', 'note:c2']);
  });

  it('does not move focus when the fold arrow is pressed, so the first click lands', () => {
    mount();
    const toggle = item('note:p').querySelector('[title="ExpandChildren"], [title="CollapseChildren"]')!;
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    toggle.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it('keeps the toggle tooltip out of what a row reads as', () => {
    mount();
    const row = item('note:p');
    const readable = (el: Node): string =>
      el.nodeType === Node.TEXT_NODE
        ? (el.textContent ?? '')
        : (el as Element).getAttribute('aria-hidden') === 'true'
          ? ''
          : [...el.childNodes].map(readable).join('');
    expect(readable(row)).toBe('p');
    const tooltips = [...row.querySelectorAll('[title="ExpandChildren"], [title="CollapseChildren"]')];
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0].closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
