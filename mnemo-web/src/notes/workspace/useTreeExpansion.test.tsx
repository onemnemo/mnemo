// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import { hierarchyOf } from '../tree/tree-model';
import { useTreeExpansion } from './useTreeExpansion';

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

const folders: NoteFolderDto[] = [{ id: 'f', name: 'f', parentId: null, order: 0 }];
const notes = [note('p', { folderId: 'f' }), note('c', { parentNoteId: 'p', folderId: 'f' }), note('g', { parentNoteId: 'c', folderId: 'f' })];

type Expansion = ReturnType<typeof useTreeExpansion>;
type Args = Parameters<typeof useTreeExpansion>[0];

let container: HTMLElement;
let root: Root;
let latest: Expansion;

function Probe(args: Omit<Args, 'hierarchy'>) {
  latest = useTreeExpansion({
    ...args,
    hierarchy: args.notes && args.folders ? hierarchyOf(args.notes, args.folders) : undefined,
  });
  return null;
}
const render = (args: Omit<Args, 'hierarchy'>) => act(() => root.render(<StrictMode><Probe {...args} /></StrictMode>));
const sorted = (ids: ReadonlySet<string>) => [...ids].sort();

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

describe('useTreeExpansion', () => {
  it('starts with every note folded and remembers what the user opens', () => {
    render({ notes, folders });
    expect(latest.expandedNotes.size).toBe(0);
    act(() => latest.toggleNote('p'));
    expect(sorted(latest.expandedNotes)).toEqual(['p']);
    expect(localStorage.getItem('mnemo.notes.expanded-notes')).toBe('["p"]');
  });

  it('reads what an earlier visit left open', () => {
    localStorage.setItem('mnemo.notes.expanded-notes', '["p"]');
    render({ notes, folders });
    expect(sorted(latest.expandedNotes)).toEqual(['p']);
  });

  it('forgets notes and folders that no longer exist', () => {
    localStorage.setItem('mnemo.notes.expanded-notes', '["p","gone"]');
    localStorage.setItem('mnemo.notes.collapsed-folders', '["f","gone"]');
    render({ notes, folders });
    expect(sorted(latest.expandedNotes)).toEqual(['p']);
    expect(sorted(latest.collapsed)).toEqual(['f']);
    expect(localStorage.getItem('mnemo.notes.expanded-notes')).toBe('["p"]');
  });

  it('keeps stored ids until the library has answered', () => {
    localStorage.setItem('mnemo.notes.expanded-notes', '["p"]');
    render({ notes: undefined, folders: undefined });
    expect(sorted(latest.expandedNotes)).toEqual(['p']);
  });

  it('opens the way to a nested note, and the folder that holds it', () => {
    localStorage.setItem('mnemo.notes.collapsed-folders', '["f"]');
    render({ noteId: 'g', notes, folders });
    expect(sorted(latest.expandedNotes)).toEqual(['c', 'p']);
    expect(latest.collapsed.size).toBe(0);
  });

  it('waits for the library before revealing', () => {
    render({ noteId: 'g', notes: undefined, folders: undefined });
    expect(latest.expandedNotes.size).toBe(0);
    render({ noteId: 'g', notes, folders });
    expect(sorted(latest.expandedNotes)).toEqual(['c', 'p']);
  });

  it('reveals once per visit to a note so the user can fold it again', () => {
    render({ noteId: 'g', notes, folders });
    act(() => latest.toggleNote('p'));
    render({ noteId: 'g', notes: [...notes], folders: [...folders] });
    expect(sorted(latest.expandedNotes)).toEqual(['c']);
  });

  it('reveals again on arriving at another nested note', () => {
    render({ noteId: 'c', notes, folders });
    expect(sorted(latest.expandedNotes)).toEqual(['p']);
    render({ noteId: 'g', notes, folders });
    expect(sorted(latest.expandedNotes)).toEqual(['c', 'p']);
  });

  it('leaves a top level note alone', () => {
    render({ noteId: 'p', notes, folders });
    expect(latest.expandedNotes.size).toBe(0);
  });
});
