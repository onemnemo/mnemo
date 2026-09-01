import { describe, expect, it } from 'vitest';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';
import { buildBreadcrumb, collapseBreadcrumb, isEllipsis, MAX_SEGMENT_CHARS } from './breadcrumb-model';

function folder(over: Partial<NoteFolderDto> & { id: string }): NoteFolderDto {
  return { name: over.id, parentId: null, order: 0, ...over };
}
function note(over: Partial<NoteSummaryDto> & { id: string }): NoteSummaryDto {
  return {
    sid: over.id, ver: 1, title: over.id, folderId: null, parentNoteId: null, order: 0,
    isFavorite: false, emoji: null, cover: null, coverCrop: null, tags: [],
    createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-01-01T00:00:00Z', ...over,
  };
}

describe('buildBreadcrumb', () => {
  it('walks the folder path root-first, then the note itself', () => {
    const folders = [folder({ id: 'root', name: 'Root' }), folder({ id: 'sub', name: 'Sub', parentId: 'root' })];
    const current = note({ id: 'n', title: 'Note', folderId: 'sub' });
    const chain = buildBreadcrumb({ note: current, folders, notes: [current], untitled: 'Untitled' });
    expect(chain.map((s) => `${s.kind}:${s.title}`)).toEqual(['folder:Root', 'folder:Sub', 'note:Note']);
    expect(chain.at(-1)?.current).toBe(true);
  });

  it('includes the parent-page chain between the folders and the current note', () => {
    const parent = note({ id: 'p', title: 'Parent', folderId: 'f' });
    const current = note({ id: 'c', title: 'Child', folderId: 'f', parentNoteId: 'p' });
    const chain = buildBreadcrumb({
      note: current,
      folders: [folder({ id: 'f', name: 'Folder' })],
      notes: [parent, current],
      untitled: 'Untitled',
    });
    expect(chain.map((s) => s.title)).toEqual(['Folder', 'Parent', 'Child']);
  });

  it('falls back to the untitled label for a blank title', () => {
    const current = note({ id: 'n', title: '   ' });
    const chain = buildBreadcrumb({ note: current, folders: [], notes: [current], untitled: 'Untitled note' });
    expect(chain[0].title).toBe('Untitled note');
  });

  it('stops the folder path at a deleted ancestor rather than stranding it', () => {
    const current = note({ id: 'n', folderId: 'sub' });
    const chain = buildBreadcrumb({
      note: current,
      folders: [folder({ id: 'sub', name: 'Sub', parentId: 'gone' })],
      notes: [current],
      untitled: 'Untitled',
    });
    expect(chain.map((s) => s.kind)).toEqual(['folder', 'note']);
  });

  it('survives a folder cycle in persisted data', () => {
    const folders = [folder({ id: 'a', parentId: 'b' }), folder({ id: 'b', parentId: 'a' })];
    const current = note({ id: 'n', folderId: 'a' });
    const chain = buildBreadcrumb({ note: current, folders, notes: [current], untitled: 'U' });
    // Two folders at most, then the note, and it terminates.
    expect(chain.at(-1)?.id).toBe('n');
    expect(chain.length).toBeLessThanOrEqual(3);
  });

  it('survives a parent-note cycle in persisted data', () => {
    const a = note({ id: 'a', parentNoteId: 'b' });
    const b = note({ id: 'b', parentNoteId: 'a' });
    const chain = buildBreadcrumb({ note: a, folders: [], notes: [a, b], untitled: 'U' });
    expect(chain.at(-1)?.id).toBe('a');
    expect(chain.filter((s) => s.current)).toHaveLength(1);
  });

  it('truncates a long crumb and flags it for a tooltip', () => {
    const long = 'x'.repeat(MAX_SEGMENT_CHARS + 10);
    const current = note({ id: 'n', title: long });
    const [seg] = buildBreadcrumb({ note: current, folders: [], notes: [current], untitled: 'U' });
    expect(seg.truncated).toBe(true);
    expect(seg.label.endsWith('…')).toBe(true);
    expect(seg.label.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS + 1);
    expect(seg.title).toBe(long);
  });
});

describe('collapseBreadcrumb', () => {
  const chainOf = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      buildBreadcrumb({
        note: note({ id: `s${String(i)}`, title: `S${String(i)}` }),
        folders: [],
        notes: [note({ id: `s${String(i)}`, title: `S${String(i)}` })],
        untitled: 'U',
      })[0],
    );

  it('shows every crumb when the chain fits', () => {
    const pieces = collapseBreadcrumb(chainOf(4));
    expect(pieces.some(isEllipsis)).toBe(false);
    expect(pieces).toHaveLength(4);
  });

  it('collapses a deep chain to first, ellipsis, parent, current', () => {
    const chain = chainOf(7);
    const pieces = collapseBreadcrumb(chain);
    expect(pieces).toHaveLength(4);
    expect(pieces[0]).toMatchObject({ id: 's0' });
    expect(isEllipsis(pieces[1])).toBe(true);
    expect(pieces[2]).toMatchObject({ id: 's5' });
    expect(pieces[3]).toMatchObject({ id: 's6' });
  });

  it('folds every middle crumb into the ellipsis, in order', () => {
    const chain = chainOf(7);
    const [, ellipsis] = collapseBreadcrumb(chain);
    if (!isEllipsis(ellipsis)) throw new Error('expected ellipsis');
    expect(ellipsis.hidden.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('keeps width bounded no matter how deep the note is', () => {
    expect(collapseBreadcrumb(chainOf(50))).toHaveLength(4);
  });
});
