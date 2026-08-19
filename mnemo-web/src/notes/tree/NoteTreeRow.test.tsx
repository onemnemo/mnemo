// @vitest-environment jsdom

/**
 * Renaming is the one sidebar verb that puts a caret on screen, and the right-click
 * menu closes over the top of it, so it is checked against the real rows rather than
 * a stand-in: mount the row, drive rename the way a user does, and look for the field
 * afterwards. Both rows carry their own copy of the state, so both are checked.
 */

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoteFolderRowModel, NoteRowModel } from './tree-model';
import type { TreeDrag } from './useNoteTreeDrag';
import { FolderRow, NoteRow } from './NoteTreeRow';

const mocks = vi.hoisted(() => ({
  saveFolder: vi.fn(async () => {}),
  deleteFolder: vi.fn(async () => {}),
  createNote: vi.fn(async () => ({ id: 'n9' })),
  updateNote: vi.fn(async () => {}),
  deleteNote: vi.fn(async () => {}),
  duplicateNote: vi.fn(async () => ({ id: 'n8' })),
  navigate: vi.fn(),
  undo: vi.fn(),
  openTab: vi.fn(),
  openTransfer: vi.fn(),
}));

vi.mock('../api', () => ({
  useSaveNoteFolder: () => ({ mutateAsync: mocks.saveFolder }),
  useDeleteNoteFolder: () => ({ mutateAsync: mocks.deleteFolder }),
  useCreateNote: () => ({ mutateAsync: mocks.createNote }),
  useUpdateNoteMetadata: () => ({ mutateAsync: mocks.updateNote }),
  useDeleteNote: () => ({ mutateAsync: mocks.deleteNote }),
  useDuplicateNote: () => ({ mutateAsync: mocks.duplicateNote }),
}));

vi.mock('@/app/router', () => ({ navigate: mocks.navigate }));
vi.mock('@/i18n/useT', () => ({ useT: () => (_ns: string, key: string) => key }));
// Deleting raises the undo toast, which reaches for the query cache these rows are mounted without.
vi.mock('@/trash/undo', () => ({ useUndoDelete: () => mocks.undo }));
vi.mock('../workspace/tabs', () => ({
  useNoteTabs: (select: (state: { open: unknown }) => unknown) => select({ open: mocks.openTab }),
}));
vi.mock('../transfer/store', () => ({
  useNoteTransfer: (select: (state: { open: unknown }) => unknown) => select({ open: mocks.openTransfer }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const drag: TreeDrag = {
  sourceKey: null,
  handle: null,
  target: null,
  ghostRef: { current: null },
  placeGhost: () => {},
  press: () => {},
  suppressClick: () => false,
} as unknown as TreeDrag;

const folderRow: NoteFolderRowModel = {
  kind: 'folder',
  id: 'f1',
  depth: 0,
  folder: { id: 'f1', name: 'Anatomy', parentId: null, order: 0 } as NoteFolderRowModel['folder'],
  noteCount: 3,
  expanded: true,
};

const noteRow: NoteRowModel = {
  kind: 'note',
  id: 'n1',
  depth: 0,
  note: {
    id: 'n1',
    title: 'Cranial nerves',
    folderId: 'f1',
    parentNoteId: null,
    order: 0,
    isFavorite: false,
  } as NoteRowModel['note'],
};

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

function mount(node: ReactNode): void {
  act(() => root.render(node));
}

/**
 * A closing menu settles in two steps and the order is what the bug lives in: the row mounts
 * its editor on a microtask, then Radix restores focus from a timeout. Render the first before
 * running the second, or the timeout finds nothing to steal focus from and the check passes
 * against code a browser would break.
 */
async function settle(): Promise<void> {
  await act(async () => {});
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function rowElement(): HTMLElement {
  const element = container.querySelector<HTMLElement>("[role='treeitem']");
  expect(element).not.toBeNull();
  return element!;
}

function nameInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input');
}

function openContextMenu(): void {
  act(() => {
    // The press that raises the menu focuses the row first, and that is the element Radix
    // hands focus back to on the way out, so the row has to hold it here too.
    rowElement().focus();
    rowElement().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
}

function chooseMenuItem(label: string): void {
  const item = [...document.querySelectorAll("[role='menuitem']")].find((el) => el.textContent === label);
  expect(item, `no menu item labelled ${label}`).not.toBeUndefined();
  act(() => {
    (item as HTMLElement).click();
  });
}

/** React tracks the value it last wrote, so a bare assignment reads back as no change. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pressKey(target: EventTarget, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('notes sidebar folder row', () => {
  it('leaves the editor on screen when rename comes from the right-click menu', async () => {
    mount(<FolderRow row={folderRow} onToggle={() => {}} drag={drag} />);

    openContextMenu();
    chooseMenuItem('Rename');
    await settle();

    expect(nameInput()).not.toBeNull();
    expect(nameInput()?.value).toBe('Anatomy');
  });

  it('saves the typed name on Enter', async () => {
    mount(<FolderRow row={folderRow} onToggle={() => {}} drag={drag} />);

    openContextMenu();
    chooseMenuItem('Rename');
    await settle();

    type(nameInput()!, 'Physiology');
    pressKey(nameInput()!, 'Enter');
    await settle();

    expect(mocks.saveFolder).toHaveBeenCalledWith({ id: 'f1', name: 'Physiology', parentId: null, order: 0 });
    expect(nameInput()).toBeNull();
  });

  // Rename is the only verb that keeps focus. Holding it for the whole menu would leave a
  // keyboard user on the body after any other close, with the next Tab back at the top of
  // the sidebar.
  it('hands the row back its focus when the menu closes on anything else', async () => {
    mount(<FolderRow row={folderRow} onToggle={() => {}} drag={drag} />);

    openContextMenu();
    chooseMenuItem('NewNote');
    await settle();

    expect(document.activeElement).toBe(rowElement());
  });
});

describe('notes sidebar note row', () => {
  it('leaves the editor on screen when rename comes from the right-click menu', async () => {
    mount(<NoteRow row={noteRow} selected={false} drag={drag} />);

    openContextMenu();
    chooseMenuItem('Rename');
    await settle();

    expect(nameInput()).not.toBeNull();
    expect(nameInput()?.value).toBe('Cranial nerves');
  });

  it('saves the typed title on Enter', async () => {
    mount(<NoteRow row={noteRow} selected={false} drag={drag} />);

    openContextMenu();
    chooseMenuItem('Rename');
    await settle();

    type(nameInput()!, 'Cranial nerve roots');
    pressKey(nameInput()!, 'Enter');
    await settle();

    expect(mocks.updateNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1', title: 'Cranial nerve roots' }));
    expect(nameInput()).toBeNull();
  });

  it('throws the typed title away on Escape', async () => {
    mount(<NoteRow row={noteRow} selected={false} drag={drag} />);

    openContextMenu();
    chooseMenuItem('Rename');
    await settle();

    type(nameInput()!, 'Something else');
    pressKey(nameInput()!, 'Escape');
    await settle();

    expect(mocks.updateNote).not.toHaveBeenCalled();
    expect(nameInput()).toBeNull();
  });

  it('hands the row back its focus when the menu closes on anything else', async () => {
    mount(<NoteRow row={noteRow} selected={false} drag={drag} />);

    openContextMenu();
    chooseMenuItem('Favourite');
    await settle();

    expect(document.activeElement).toBe(rowElement());
  });
});
