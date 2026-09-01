import { describe, expect, it } from 'vitest';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';
import { buildNoteTree, compareNotes, effectiveFolderId } from './tree-model';

function folder(over: Partial<NoteFolderDto> & { id: string }): NoteFolderDto {
  return { name: over.id, parentId: null, order: 0, ...over };
}

let seq = 0;
function note(over: Partial<NoteSummaryDto> & { id: string }): NoteSummaryDto {
  seq += 1;
  return {
    sid: over.id,
    ver: 1,
    title: over.id,
    folderId: null,
    parentNoteId: null,
    order: 0,
    isFavorite: false,
    emoji: null,
    cover: null,
    coverCrop: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: `2026-01-0${String((seq % 9) + 1)}T00:00:00Z`,
    ...over,
  };
}

const EMPTY = { collapsed: new Set<string>(), search: '' };

describe('buildNoteTree', () => {
  it('nests folders and places notes as leaves in their folder', () => {
    const tree = buildNoteTree({
      folders: [folder({ id: 'f1' }), folder({ id: 'f1a', parentId: 'f1' })],
      notes: [note({ id: 'n1', folderId: 'f1' }), note({ id: 'n2', folderId: 'f1a' })],
      ...EMPTY,
    });
    expect(tree.rows.map((r) => `${r.kind}:${r.id}@${String(r.depth)}`)).toEqual([
      'folder:f1@0',
      'folder:f1a@1',
      'note:n2@2',
      'note:n1@1',
    ]);
  });

  it('counts every note in a folder subtree, subfolders included', () => {
    const tree = buildNoteTree({
      folders: [folder({ id: 'f1' }), folder({ id: 'f1a', parentId: 'f1' })],
      notes: [note({ id: 'n1', folderId: 'f1' }), note({ id: 'n2', folderId: 'f1a' }), note({ id: 'n3', folderId: 'f1a' })],
      ...EMPTY,
    });
    const f1 = tree.rows.find((r) => r.id === 'f1');
    expect(f1?.kind === 'folder' && f1.noteCount).toBe(3);
  });

  it('draws a note whose folder was deleted at the root, not stranded', () => {
    const tree = buildNoteTree({ folders: [], notes: [note({ id: 'orphan', folderId: 'gone' })], ...EMPTY });
    expect(tree.rows).toEqual([{ kind: 'note', id: 'orphan', depth: 0, note: expect.objectContaining({ id: 'orphan' }) }]);
  });

  it('draws a folder whose parent was deleted at the root', () => {
    const tree = buildNoteTree({ folders: [folder({ id: 'f', parentId: 'gone' })], notes: [], ...EMPTY });
    expect(tree.rows.map((r) => `${r.id}@${String(r.depth)}`)).toEqual(['f@0']);
  });

  it('excludes a child page (parentNoteId set) from rows, favourites and counts', () => {
    const tree = buildNoteTree({
      folders: [folder({ id: 'f1' })],
      notes: [
        note({ id: 'top', folderId: 'f1' }),
        note({ id: 'child', folderId: 'f1', parentNoteId: 'top', isFavorite: true }),
      ],
      ...EMPTY,
    });
    expect(tree.rows.map((r) => r.id)).toEqual(['f1', 'top']);
    const f1 = tree.rows.find((r) => r.id === 'f1');
    expect(f1?.kind === 'folder' && f1.noteCount).toBe(1);
    expect(tree.favourites.map((n) => n.id)).toEqual([]);
  });

  it('lists favourites flat, newest-touched first, regardless of folder', () => {
    const tree = buildNoteTree({
      folders: [folder({ id: 'f1' })],
      notes: [
        note({ id: 'a', folderId: 'f1', isFavorite: true, modifiedAt: '2026-05-01T00:00:00Z' }),
        note({ id: 'b', isFavorite: true, modifiedAt: '2026-06-01T00:00:00Z' }),
        note({ id: 'c', folderId: 'f1' }),
      ],
      ...EMPTY,
    });
    expect(tree.favourites.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('hides a collapsed folder’s children but keeps its count', () => {
    const tree = buildNoteTree({
      folders: [folder({ id: 'f1' })],
      notes: [note({ id: 'n1', folderId: 'f1' })],
      collapsed: new Set(['f1']),
      search: '',
    });
    expect(tree.rows.map((r) => r.id)).toEqual(['f1']);
    const f1 = tree.rows[0];
    expect(f1.kind === 'folder' && f1.noteCount).toBe(1);
  });

  it('flattens to matching notes only while searching, dropping folders and favourites', () => {
    const tree = buildNoteTree({
      folders: [folder({ id: 'f1' })],
      notes: [
        note({ id: 'alpha', title: 'Alpha', folderId: 'f1', isFavorite: true }),
        note({ id: 'beta', title: 'Beta', folderId: 'f1' }),
      ],
      collapsed: new Set(),
      search: 'alph',
    });
    expect(tree.rows.map((r) => `${r.kind}:${r.id}`)).toEqual(['note:alpha']);
    expect(tree.favourites).toEqual([]);
  });

  it('orders sibling notes by order, then most-recently-modified', () => {
    const list = [
      note({ id: 'later-order', order: 2 }),
      note({ id: 'newer', order: 1, modifiedAt: '2026-09-01T00:00:00Z' }),
      note({ id: 'older', order: 1, modifiedAt: '2026-01-01T00:00:00Z' }),
    ].sort(compareNotes);
    expect(list.map((n) => n.id)).toEqual(['newer', 'older', 'later-order']);
  });
});

describe('effectiveFolderId', () => {
  it('is null when the note’s folder no longer exists', () => {
    expect(effectiveFolderId(note({ id: 'n', folderId: 'gone' }), new Set(['real']))).toBeNull();
    expect(effectiveFolderId(note({ id: 'n', folderId: 'real' }), new Set(['real']))).toBe('real');
  });
});
