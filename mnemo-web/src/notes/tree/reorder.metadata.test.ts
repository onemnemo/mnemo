import { describe, expect, it } from 'vitest';
import type { NoteFolderDto, NoteSummaryDto, UpdateNoteMetadataDto } from '@/api/types';
import { planReorder, type TreeDragHandle } from './reorder';

// The metadata route is a full replace: whatever a reorder leaves out of the body is cleared on
// every note it touches. These assertions are whole-object on purpose, so a planner that stops
// carrying a field, or starts spreading the summary's read-only fields into the write, fails here
// rather than in a user's sidebar.

const folders: NoteFolderDto[] = [{ id: 'f1', name: 'Folder', parentId: null, order: 0 }];

function note(over: Partial<NoteSummaryDto> & { id: string }): NoteSummaryDto {
  return {
    sid: over.id, ver: 7, title: over.id, folderId: null, parentNoteId: null, order: 0,
    isFavorite: false, emoji: null, cover: null, coverCrop: null, tags: [],
    createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-02T00:00:00Z', ...over,
  };
}

const handle = (id: string): TreeDragHandle => ({ key: `note:${id}`, kind: 'note', id, label: id });

const decorated = note({
  id: 'a',
  title: 'Pharmacology notes',
  parentNoteId: 'parent',
  isFavorite: true,
  emoji: '💊',
  cover: 'asset:cover.png',
  coverCrop: '{"x":0.1,"y":0,"w":0.8,"h":1,"aspect":2}',
  tags: ['exam', 'second-year'],
});

describe('planReorder keeps every metadata field on the notes it rewrites', () => {
  it('moves a decorated note into a folder with its whole metadata intact', () => {
    const plan = planReorder(handle('a'), { mode: 'into', parentId: 'f1' }, { notes: [decorated], folders });

    const expected: UpdateNoteMetadataDto & { id: string } = {
      id: 'a',
      title: 'Pharmacology notes',
      folderId: 'f1',
      parentNoteId: 'parent',
      order: 0,
      isFavorite: true,
      emoji: '💊',
      cover: 'asset:cover.png',
      coverCrop: '{"x":0.1,"y":0,"w":0.8,"h":1,"aspect":2}',
      tags: ['exam', 'second-year'],
    };
    expect(plan.noteUpdates).toStrictEqual([expected]);
  });

  it('rewrites a displaced sibling with its own metadata, not the dragged note\'s', () => {
    const sibling = note({ id: 'b', order: 0, emoji: '📚', tags: ['reading'], isFavorite: true });
    const mover = note({ id: 'c', order: 1 });

    const plan = planReorder(handle('c'), { mode: 'above', parentId: null, refId: 'b' }, { notes: [sibling, mover], folders });

    expect(plan.noteUpdates).toStrictEqual([
      {
        id: 'c', title: 'c', folderId: null, parentNoteId: null, order: 0,
        isFavorite: false, emoji: null, cover: null, coverCrop: null, tags: [],
      },
      {
        id: 'b', title: 'b', folderId: null, parentNoteId: null, order: 1,
        isFavorite: true, emoji: '📚', cover: null, coverCrop: null, tags: ['reading'],
      },
    ]);
  });

  it('sends coverCrop as null for a note stored before the field existed', () => {
    const legacy = { ...note({ id: 'old' }), coverCrop: undefined as unknown as string | null };

    const plan = planReorder(handle('old'), { mode: 'into', parentId: 'f1' }, { notes: [legacy], folders });

    expect(plan.noteUpdates[0].coverCrop).toBeNull();
    expect(Object.keys(plan.noteUpdates[0]).sort()).toEqual(
      ['cover', 'coverCrop', 'emoji', 'folderId', 'id', 'isFavorite', 'order', 'parentNoteId', 'tags', 'title'],
    );
  });
});
