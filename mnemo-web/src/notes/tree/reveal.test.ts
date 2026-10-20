import { describe, expect, it } from 'vitest';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import { hierarchyOf } from './tree-model';
import { revealTargets as reveal } from './reveal';

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
const folder = (id: string, parentId: string | null = null): NoteFolderDto => ({ id, name: id, parentId, order: 0 });

const revealTargets = (id: string, notes: NoteSummaryDto[], folders: NoteFolderDto[]) =>
  reveal(id, notes, folders, hierarchyOf(notes, folders));

describe('revealTargets', () => {
  const folders = [folder('outer'), folder('inner', 'outer')];
  const notes = [
    note('p', { folderId: 'inner' }),
    note('c', { parentNoteId: 'p', folderId: 'inner' }),
    note('g', { parentNoteId: 'c', folderId: 'inner' }),
  ];

  it('names the notes above a nested note and the folders holding the topmost one', () => {
    expect(revealTargets('g', notes, folders)).toEqual({ noteIds: ['p', 'c'], folderIds: ['inner', 'outer'] });
  });

  it('asks for nothing when the row is already where it always is', () => {
    expect(revealTargets('p', notes, folders)).toEqual({ noteIds: [], folderIds: [] });
    expect(revealTargets('missing', notes, folders)).toEqual({ noteIds: [], folderIds: [] });
  });

  it('reveals nothing for a child drawn apart from a parent in another folder', () => {
    const list = [note('p', { folderId: 'inner' }), note('c', { parentNoteId: 'p', folderId: 'outer' })];
    expect(revealTargets('c', list, folders)).toEqual({ noteIds: [], folderIds: [] });
  });

  it('survives folders that name each other as parent', () => {
    const looped = [folder('x', 'y'), folder('y', 'x')];
    const list = [note('p', { folderId: 'x' }), note('c', { parentNoteId: 'p', folderId: 'x' })];
    expect(revealTargets('c', list, looped).folderIds).toEqual(['x', 'y']);
  });
});
