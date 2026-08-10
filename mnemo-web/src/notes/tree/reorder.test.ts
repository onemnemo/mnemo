import { describe, expect, it } from 'vitest';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';
import {
  planReorder,
  resolveTreeDrop,
  type MeasuredRow,
  type TreeDragHandle,
  type TreeDropTarget,
} from './reorder';

function folder(over: Partial<NoteFolderDto> & { id: string }): NoteFolderDto {
  return { name: over.id, parentId: null, order: 0, ...over };
}
function note(over: Partial<NoteSummaryDto> & { id: string }): NoteSummaryDto {
  return {
    sid: over.id, ver: 1, title: over.id, folderId: null, parentNoteId: null, order: 0,
    isFavorite: false, emoji: null, cover: null, tags: [],
    createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-01T00:00:00Z', ...over,
  };
}
const noteHandle = (id: string): TreeDragHandle => ({ key: `note:${id}`, kind: 'note', id, label: id });
const folderHandle = (id: string): TreeDragHandle => ({ key: `folder:${id}`, kind: 'folder', id, label: id });

describe('planReorder — notes', () => {
  const notes = [
    note({ id: 'a', folderId: null, order: 0 }),
    note({ id: 'b', folderId: null, order: 1 }),
    note({ id: 'f1n', folderId: 'f1', order: 0 }),
  ];
  const folders = [folder({ id: 'f1' })];

  it('moves a note into a folder and appends it after that folder’s notes', () => {
    const target: TreeDropTarget = { mode: 'into', parentId: 'f1' };
    const plan = planReorder(noteHandle('a'), target, { notes, folders });
    expect(plan.folderUpdates).toEqual([]);
    expect(plan.noteUpdates).toEqual([
      expect.objectContaining({ id: 'a', folderId: 'f1', order: 1 }),
    ]);
  });

  it('carries parentNoteId through a move untouched', () => {
    const withParent = [note({ id: 'child', parentNoteId: 'p', folderId: null, order: 0 })];
    const plan = planReorder(noteHandle('child'), { mode: 'into', parentId: 'f1' }, { notes: withParent, folders });
    expect(plan.noteUpdates[0]).toMatchObject({ id: 'child', folderId: 'f1', parentNoteId: 'p' });
  });

  it('reorders a note above a sibling, reindexing the destination list', () => {
    const plan = planReorder(noteHandle('b'), { mode: 'above', parentId: null, refId: 'a' }, { notes, folders });
    // b jumps ahead of a: b→0, a→1.
    expect(plan.noteUpdates).toEqual([
      expect.objectContaining({ id: 'b', folderId: null, order: 0 }),
      expect.objectContaining({ id: 'a', folderId: null, order: 1 }),
    ]);
  });

  it('sends a note to the root when dropped there', () => {
    const plan = planReorder(noteHandle('f1n'), { mode: 'root', parentId: null }, { notes, folders });
    expect(plan.noteUpdates).toEqual([
      expect.objectContaining({ id: 'f1n', folderId: null, order: 2 }),
    ]);
  });

  it('plans nothing when a note is dropped where it already sits', () => {
    const plan = planReorder(noteHandle('b'), { mode: 'below', parentId: null, refId: 'a' }, { notes, folders });
    expect(plan.noteUpdates).toEqual([]);
  });

  it('does not treat a hidden child page as a sibling when reindexing', () => {
    const withChild = [
      note({ id: 'a', folderId: 'f1', order: 0 }),
      note({ id: 'hidden', folderId: 'f1', parentNoteId: 'a', order: 5 }),
    ];
    const incoming = note({ id: 'x', folderId: null, order: 0 });
    const plan = planReorder(noteHandle('x'), { mode: 'into', parentId: 'f1' }, { notes: [...withChild, incoming], folders });
    // Only 'a' counts as a sibling, so x lands at order 1, not 2.
    expect(plan.noteUpdates).toEqual([expect.objectContaining({ id: 'x', folderId: 'f1', order: 1 })]);
  });
});

describe('planReorder — folders', () => {
  const folders = [
    folder({ id: 'f1', order: 0 }),
    folder({ id: 'f2', order: 1 }),
    folder({ id: 'child', parentId: 'f1', order: 0 }),
  ];

  it('nests a folder into another, appending after its subfolders', () => {
    const plan = planReorder(folderHandle('f2'), { mode: 'into', parentId: 'f1' }, { notes: [], folders });
    expect(plan.noteUpdates).toEqual([]);
    expect(plan.folderUpdates).toEqual([expect.objectContaining({ id: 'f2', parentId: 'f1', order: 1 })]);
  });

  it('reorders a folder below a sibling', () => {
    const plan = planReorder(folderHandle('f1'), { mode: 'below', parentId: null, refId: 'f2' }, { notes: [], folders });
    expect(plan.folderUpdates).toEqual([
      expect.objectContaining({ id: 'f2', parentId: null, order: 0 }),
      expect.objectContaining({ id: 'f1', parentId: null, order: 1 }),
    ]);
  });

  it('refuses to nest a folder into itself', () => {
    const plan = planReorder(folderHandle('f1'), { mode: 'into', parentId: 'f1' }, { notes: [], folders });
    expect(plan.folderUpdates).toEqual([]);
  });

  it('refuses to nest a folder into its own descendant', () => {
    const plan = planReorder(folderHandle('f1'), { mode: 'into', parentId: 'child' }, { notes: [], folders });
    expect(plan.folderUpdates).toEqual([]);
  });

  it('plans nothing when a folder is dropped where it already sits', () => {
    const plan = planReorder(folderHandle('f1'), { mode: 'above', parentId: null, refId: 'f2' }, { notes: [], folders });
    expect(plan.folderUpdates).toEqual([]);
  });
});

// Geometry: pointer + measured rows → target. Rows are laid out as a vertical stack.
function row(over: Partial<MeasuredRow> & { id: string; kind: 'folder' | 'note'; top: number }): MeasuredRow {
  return {
    key: `${over.kind}:${over.id}`,
    depth: over.depth ?? 0,
    folderId: over.folderId ?? (over.kind === 'folder' ? over.id : null),
    box: { top: over.top, left: 0, width: 200, height: 20 },
    ...over,
  } as MeasuredRow;
}
const surface = { top: 0, left: 0, width: 200, height: 400 };

describe('resolveTreeDrop', () => {
  const folders = [folder({ id: 'f1' }), folder({ id: 'f2' })];

  it('nests a note into a folder hovered near its middle', () => {
    const rows = [row({ id: 'f1', kind: 'folder', top: 0 }), row({ id: 'f2', kind: 'folder', top: 20 })];
    const target = resolveTreeDrop({ pointer: { x: 10, y: 10 }, rows, surface, source: noteHandle('n'), folders });
    expect(target).toMatchObject({ mode: 'into', parentId: 'f1' });
  });

  it('reorders a note above another note in the top half', () => {
    const rows = [row({ id: 'a', kind: 'note', top: 0, folderId: null }), row({ id: 'b', kind: 'note', top: 20, folderId: null })];
    const target = resolveTreeDrop({ pointer: { x: 10, y: 22 }, rows, surface, source: noteHandle('a'), folders });
    expect(target).toMatchObject({ mode: 'above', parentId: null, refId: 'b' });
  });

  it('nests a folder into another over its middle band', () => {
    const rows = [row({ id: 'f1', kind: 'folder', top: 0 }), row({ id: 'f2', kind: 'folder', top: 20 })];
    const target = resolveTreeDrop({ pointer: { x: 10, y: 30 }, rows, surface, source: folderHandle('f1'), folders });
    expect(target).toMatchObject({ mode: 'into', parentId: 'f2' });
  });

  it('reorders a folder above another in the top quarter', () => {
    const rows = [row({ id: 'f1', kind: 'folder', top: 0 }), row({ id: 'f2', kind: 'folder', top: 20 })];
    const target = resolveTreeDrop({ pointer: { x: 10, y: 22 }, rows, surface, source: folderHandle('f1'), folders });
    expect(target).toMatchObject({ mode: 'above', refId: 'f2' });
  });

  it('reads a drop over no row as the root', () => {
    const rows = [row({ id: 'f1', kind: 'folder', top: 0 })];
    const target = resolveTreeDrop({ pointer: { x: 10, y: 300 }, rows, surface, source: noteHandle('n'), folders });
    expect(target).toMatchObject({ mode: 'root', parentId: null });
  });

  it('reads a drop off the surface as nothing', () => {
    const rows = [row({ id: 'f1', kind: 'folder', top: 0 })];
    expect(resolveTreeDrop({ pointer: { x: 10, y: 900 }, rows, surface, source: noteHandle('n'), folders })).toBeNull();
  });

  it('refuses to nest a folder into its own subtree', () => {
    const nested = [folder({ id: 'parent' }), folder({ id: 'kid', parentId: 'parent' })];
    const rows = [row({ id: 'parent', kind: 'folder', top: 0, depth: 0 }), row({ id: 'kid', kind: 'folder', top: 20, depth: 1 })];
    // Dragging parent onto the middle of kid would strand the subtree.
    const target = resolveTreeDrop({ pointer: { x: 10, y: 30 }, rows, surface, source: folderHandle('parent'), folders: nested });
    expect(target).toBeNull();
  });
});
