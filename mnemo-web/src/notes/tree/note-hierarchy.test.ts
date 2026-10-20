import { describe, expect, it } from 'vitest';
import type { NoteSummaryDto } from '@/api/types';
import { buildNoteHierarchy as buildIn, drawnAncestors, storedAncestors } from './note-hierarchy';

function note(id: string, parentNoteId: string | null = null, folderId: string | null = null): NoteSummaryDto {
  return {
    id,
    sid: id,
    ver: 1,
    title: id,
    folderId,
    parentNoteId,
    order: 0,
    isFavorite: false,
    emoji: null,
    cover: null,
    coverCrop: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
  };
}

const buildNoteHierarchy = (list: readonly NoteSummaryDto[]) => buildIn(list, (n) => n.folderId);

const ids = (list: readonly NoteSummaryDto[] | undefined) => (list ?? []).map((n) => n.id);

describe('buildNoteHierarchy', () => {
  it('splits top level notes from children and keeps input order', () => {
    const h = buildNoteHierarchy([note('b'), note('c2', 'a'), note('a'), note('c1', 'a')]);
    expect(ids(h.tops)).toEqual(['b', 'a']);
    expect(ids(h.childrenOf.get('a'))).toEqual(['c2', 'c1']);
    expect(h.parentOf.get('c1')).toBe('a');
    expect(h.parentOf.has('a')).toBe(false);
  });

  it('drops a link to a note that is not in the list', () => {
    const h = buildNoteHierarchy([note('orphan', 'trashed')]);
    expect(ids(h.tops)).toEqual(['orphan']);
    expect(h.parentOf.size).toBe(0);
  });

  it('places every note of a loop exactly once', () => {
    const h = buildNoteHierarchy([note('a', 'b'), note('b', 'c'), note('c', 'a'), note('tail', 'b')]);
    const placed = [...ids(h.tops), ...[...h.childrenOf.values()].flatMap(ids)];
    expect(placed.sort()).toEqual(['a', 'b', 'c', 'tail']);
    expect(h.tops).toHaveLength(1);
  });

  it('cuts a loop at the loop and keeps what hangs below it attached', () => {
    const h = buildNoteHierarchy([note('tail', 'a'), note('a', 'b'), note('b', 'a')]);
    expect(h.parentOf.get('tail')).toBe('a');
    expect(h.tops).toHaveLength(1);
  });

  it('treats a note that is its own parent as top level', () => {
    expect(ids(buildNoteHierarchy([note('x', 'x')]).tops)).toEqual(['x']);
  });

  it('handles a chain of ten thousand and a hundred children', () => {
    const chain = Array.from({ length: 10000 }, (_, i) => note(`n${String(i)}`, i === 0 ? null : `n${String(i - 1)}`));
    expect(drawnAncestors('n9999', buildNoteHierarchy(chain))).toHaveLength(9999);
    const fan = [note('p'), ...Array.from({ length: 100 }, (_, i) => note(`k${String(i)}`, 'p'))];
    expect(buildNoteHierarchy(fan).childrenOf.get('p')).toHaveLength(100);
  });
});

describe('buildNoteHierarchy across folders', () => {
  it('draws a child in another folder than its parent at the top level of its own folder', () => {
    const h = buildNoteHierarchy([note('p', null, 'a'), note('c', 'p', 'b'), note('d', 'p', 'a')]);
    expect(ids(h.tops)).toEqual(['p', 'c']);
    expect(ids(h.childrenOf.get('p'))).toEqual(['d']);
    expect(h.parentOf.has('c')).toBe(false);
  });

  it('keeps a chain together only while every link shares a folder', () => {
    const h = buildNoteHierarchy([note('a', null, 'x'), note('b', 'a', 'x'), note('c', 'b', 'y'), note('d', 'c', 'y')]);
    expect(ids(h.tops)).toEqual(['a', 'c']);
    expect(drawnAncestors('d', h)).toEqual(['c']);
  });
});

describe('drawnAncestors', () => {
  it('lists the ancestors topmost first and is empty for a top level note', () => {
    const h = buildNoteHierarchy([note('a'), note('b', 'a'), note('c', 'b')]);
    expect(drawnAncestors('c', h)).toEqual(['a', 'b']);
    expect(drawnAncestors('a', h)).toEqual([]);
  });
});

describe('storedAncestors', () => {
  it('follows the stored parents and stops at a missing parent or a repeat', () => {
    const list = [note('a', 'b'), note('b', 'a'), note('c', 'gone'), note('d', 'a')];
    const byId = new Map(list.map((n) => [n.id, n]));
    expect(ids(storedAncestors(byId.get('d')!, byId))).toEqual(['b', 'a']);
    expect(ids(storedAncestors(byId.get('c')!, byId))).toEqual([]);
  });
});
