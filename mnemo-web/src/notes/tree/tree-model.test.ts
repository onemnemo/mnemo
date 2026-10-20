import { describe, expect, it } from 'vitest';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';
import {
  buildNoteTree as buildWith,
  compareNotes,
  effectiveFolderId,
  hierarchyOf,
  notesInFolderSubtree,
  type BuildNoteTreeOptions,
} from './tree-model';

const buildNoteTree = (options: Omit<BuildNoteTreeOptions, 'hierarchy'>) =>
  buildWith({ ...options, hierarchy: hierarchyOf(options.notes, options.folders) });

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

const EMPTY = { collapsed: new Set<string>(), expandedNotes: new Set<string>(), search: '' };

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

  it('gives nested folders an unambiguous visible path', () => {
    const tree = buildNoteTree({
      folders: [folder({ id: 'f1', name: 'Medicine' }), folder({ id: 'f1a', name: 'Anatomy', parentId: 'f1' })],
      notes: [],
      ...EMPTY,
    });

    expect(tree.rows.filter((row) => row.kind === 'folder').map((row) => row.path)).toEqual([
      'Medicine',
      'Medicine / Anatomy',
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
    expect(tree.rows).toEqual([{ kind: 'note', id: 'orphan', depth: 0, parentTitles: [], childCount: 0, expanded: false, expandable: true, note: expect.objectContaining({ id: 'orphan' }) }]);
  });

  it('draws a folder whose parent was deleted at the root', () => {
    const tree = buildNoteTree({ folders: [folder({ id: 'f', parentId: 'gone' })], notes: [], ...EMPTY });
    expect(tree.rows.map((r) => `${r.id}@${String(r.depth)}`)).toEqual(['f@0']);
  });

  it('keeps a collapsed child out of the rows, counts it in its folder, and lists it as a favourite', () => {
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
    expect(f1?.kind === 'folder' && f1.noteCount).toBe(2);
    expect(tree.favourites.map((n) => n.id)).toEqual(['child']);
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
      ...EMPTY,
      collapsed: new Set(['f1']),
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
      ...EMPTY,
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

describe('notesInFolderSubtree', () => {
  const folders = [
    folder({ id: 'top' }),
    folder({ id: 'mid', parentId: 'top' }),
    folder({ id: 'deep', parentId: 'mid' }),
    folder({ id: 'other' }),
  ];

  it('collects notes at every depth and nothing outside the folder', () => {
    const notes = [
      note({ id: 'a', folderId: 'top' }),
      note({ id: 'b', folderId: 'deep' }),
      note({ id: 'c', folderId: 'other' }),
      note({ id: 'd' }),
    ];
    expect(notesInFolderSubtree('top', folders, notes).map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('leaves out nested child pages, matching the folder count', () => {
    const notes = [note({ id: 'a', folderId: 'mid' }), note({ id: 'child', folderId: 'mid', parentNoteId: 'a' })];
    expect(notesInFolderSubtree('top', folders, notes).map((n) => n.id)).toEqual(['a']);
  });

  it('survives folders that name each other as parent', () => {
    const looped = [folder({ id: 'x', parentId: 'y' }), folder({ id: 'y', parentId: 'x' })];
    const notes = [note({ id: 'a', folderId: 'y' })];
    expect(notesInFolderSubtree('x', looped, notes).map((n) => n.id)).toEqual(['a']);
  });
});

function shape(rows: ReturnType<typeof buildNoteTree>['rows']): string[] {
  return rows.map((r) => `${r.id}@${String(r.depth)}`);
}

describe('buildNoteTree with child notes', () => {
  const family = [
    note({ id: 'p', folderId: 'f1', order: 0 }),
    note({ id: 'c2', folderId: 'f1', parentNoteId: 'p', order: 1 }),
    note({ id: 'c1', folderId: 'f1', parentNoteId: 'p', order: 0 }),
    note({ id: 'g', folderId: 'f1', parentNoteId: 'c1', order: 0 }),
  ];
  const folders = [folder({ id: 'f1' })];

  it('shows a parent with its child count and no children while it is collapsed', () => {
    const tree = buildNoteTree({ folders, notes: family, ...EMPTY });
    expect(shape(tree.rows)).toEqual(['f1@0', 'p@1']);
    const p = tree.rows[1];
    expect(p.kind === 'note' && [p.childCount, p.expanded, p.expandable]).toEqual([2, false, true]);
  });

  it('draws children and grandchildren one level deeper each, in sibling order', () => {
    const tree = buildNoteTree({ folders, notes: family, ...EMPTY, expandedNotes: new Set(['p', 'c1']) });
    expect(shape(tree.rows)).toEqual(['f1@0', 'p@1', 'c1@2', 'g@3', 'c2@2']);
  });

  it('keeps a grandchild hidden while only the top parent is open', () => {
    const tree = buildNoteTree({ folders, notes: family, ...EMPTY, expandedNotes: new Set(['p']) });
    expect(shape(tree.rows)).toEqual(['f1@0', 'p@1', 'c1@2', 'c2@2']);
  });

  it('draws a child apart from a parent in another folder, with the parent in its tooltip titles', () => {
    const notes = [
      note({ id: 'p', title: 'Parent', folderId: 'f1' }),
      note({ id: 'c', title: 'Child', folderId: 'f2', parentNoteId: 'p' }),
    ];
    const tree = buildNoteTree({
      folders: [folder({ id: 'f1' }), folder({ id: 'f2', order: 1 })],
      notes,
      ...EMPTY,
      expandedNotes: new Set(['p']),
    });
    expect(shape(tree.rows)).toEqual(['f1@0', 'p@1', 'f2@0', 'c@1']);
    const child = tree.rows[3];
    expect(child.kind === 'note' && child.parentTitles).toEqual(['Parent']);
    const parent = tree.rows[1];
    expect(parent.kind === 'note' && [parent.childCount, parent.parentTitles]).toEqual([0, []]);
    const f2 = tree.rows[2];
    expect(f2.kind === 'folder' && f2.noteCount).toBe(1);
  });

  it('draws a child with its parent when both are at the root', () => {
    const notes = [note({ id: 'p' }), note({ id: 'c', parentNoteId: 'p' })];
    const tree = buildNoteTree({ folders: [], notes, ...EMPTY, expandedNotes: new Set(['p']) });
    expect(shape(tree.rows)).toEqual(['p@0', 'c@1']);
  });

  it('draws a child of a trashed or purged parent at the top of its own folder', () => {
    const notes = [note({ id: 'orphan', folderId: 'f1', parentNoteId: 'trashed' })];
    const tree = buildNoteTree({ folders, notes, ...EMPTY });
    expect(shape(tree.rows)).toEqual(['f1@0', 'orphan@1']);
  });

  it('draws every note of a loop exactly once', () => {
    const notes = [
      note({ id: 'a', parentNoteId: 'b', order: 0 }),
      note({ id: 'b', parentNoteId: 'a', order: 1 }),
      note({ id: 'self', parentNoteId: 'self', order: 2 }),
    ];
    const tree = buildNoteTree({ folders: [], notes, ...EMPTY, expandedNotes: new Set(['a', 'b']) });
    expect(shape(tree.rows)).toEqual(['a@0', 'b@1', 'self@0']);
  });

  it('draws a ten level chain and a hundred children in order', () => {
    const chain = Array.from({ length: 10 }, (_, i) =>
      note({ id: `n${String(i)}`, parentNoteId: i === 0 ? null : `n${String(i - 1)}` }),
    );
    const open = new Set(chain.map((n) => n.id));
    const deep = buildNoteTree({ folders: [], notes: chain, ...EMPTY, expandedNotes: open });
    expect(deep.rows.map((r) => r.depth)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const kids = Array.from({ length: 100 }, (_, i) => note({ id: `k${String(i)}`, parentNoteId: 'root', order: 99 - i }));
    const rows = buildNoteTree({
      folders: [],
      notes: [note({ id: 'root' }), ...kids],
      ...EMPTY,
      expandedNotes: new Set(['root']),
    }).rows;
    expect(rows).toHaveLength(101);
    expect(rows[1].id).toBe('k99');
    expect(rows[100].id).toBe('k0');
    expect(rows[0].kind === 'note' && rows[0].childCount).toBe(100);
  });

  it('shows a matching child under its ancestors with every level held open', () => {
    const tree = buildNoteTree({ folders, notes: family, ...EMPTY, search: 'g' });
    expect(shape(tree.rows)).toEqual(['p@0', 'c1@1', 'g@2']);
    expect(tree.rows.every((r) => r.kind === 'note' && !r.expandable)).toBe(true);
  });

  it('keeps a search without nesting as the flat list of matches', () => {
    const notes = [note({ id: 'a', title: 'Alpha' }), note({ id: 'b', title: 'Beta' }), note({ id: 'ab', title: 'Alphabet' })];
    const tree = buildNoteTree({ folders: [], notes, ...EMPTY, search: 'alpha' });
    expect(tree.rows.map((r) => r.depth)).toEqual([0, 0]);
    expect(tree.rows.map((r) => r.id).sort()).toEqual(['a', 'ab']);
  });
});

describe('notesInFolderSubtree with child notes', () => {
  it('counts a child of a missing parent as drawn in its folder and leaves nested children to their parent', () => {
    const folders = [folder({ id: 'top' })];
    const notes = [
      note({ id: 'p', folderId: 'top' }),
      note({ id: 'c', folderId: 'top', parentNoteId: 'p' }),
      note({ id: 'orphan', folderId: 'top', parentNoteId: 'gone' }),
    ];
    expect(notesInFolderSubtree('top', folders, notes).map((n) => n.id).sort()).toEqual(['orphan', 'p']);
  });
});

describe('notesInFolderSubtree with children in other folders', () => {
  it('counts a child under the folder that holds it, which is what a delete of that folder takes', () => {
    const folders = [folder({ id: 'a' }), folder({ id: 'b' })];
    const notes = [note({ id: 'p', folderId: 'a' }), note({ id: 'c', folderId: 'b', parentNoteId: 'p' })];
    expect(notesInFolderSubtree('b', folders, notes).map((n) => n.id)).toEqual(['c']);
    expect(notesInFolderSubtree('a', folders, notes).map((n) => n.id)).toEqual(['p']);
  });
});

describe('folder counts with child notes', () => {
  it('counts a parent and all its same-folder children, which is what deleting the folder takes', () => {
    const notes = [
      note({ id: 'p', folderId: 'f' }),
      ...Array.from({ length: 30 }, (_, i) => note({ id: `c${String(i)}`, folderId: 'f', parentNoteId: 'p' })),
      note({ id: 'g', folderId: 'f', parentNoteId: 'c0' }),
    ];
    const tree = buildNoteTree({ folders: [folder({ id: 'f' })], notes, ...EMPTY });
    const f = tree.rows[0];
    expect(f.kind === 'folder' && f.noteCount).toBe(32);
    expect(tree.rows).toHaveLength(2);
  });

  it('leaves a child in another folder to the folder that holds it and sums subfolders', () => {
    const folders = [folder({ id: 'a' }), folder({ id: 'b', parentId: 'a' }), folder({ id: 'c', order: 1 })];
    const notes = [
      note({ id: 'p', folderId: 'a' }),
      note({ id: 'inside', folderId: 'a', parentNoteId: 'p' }),
      note({ id: 'away', folderId: 'c', parentNoteId: 'p' }),
      note({ id: 'sub', folderId: 'b' }),
    ];
    const counts = Object.fromEntries(
      buildNoteTree({ folders, notes, ...EMPTY }).rows.flatMap((r) => (r.kind === 'folder' ? [[r.id, r.noteCount]] : [])),
    );
    expect(counts).toEqual({ a: 3, b: 1, c: 1 });
  });
});
