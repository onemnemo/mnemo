// @vitest-environment jsdom

/**
 * What the workspace is allowed to believe about what it stored.
 *
 * The memory is read at mount and acted on immediately, so a value written by
 * something else, or a store that refuses to answer, has to leave the workspace
 * in its unremembered state rather than throwing on the way up.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  pruneCollapsedFolders,
  readCollapsedFolders,
  readLastNoteId,
  rememberCollapsedFolders,
  rememberLastNoteId,
} from './session';

const LAST_NOTE_KEY = 'mnemo.notes.last-note';
const COLLAPSED_KEY = 'mnemo.notes.collapsed-folders';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('the note that was open', () => {
  it('comes back as it went in', () => {
    rememberLastNoteId('note-1');
    expect(readLastNoteId()).toBe('note-1');
  });

  it('reads as nothing when it was never written', () => {
    expect(readLastNoteId()).toBeNull();
  });

  it('is forgotten by null, not stored as one', () => {
    rememberLastNoteId('note-1');
    rememberLastNoteId(null);
    expect(readLastNoteId()).toBeNull();
    expect(localStorage.getItem(LAST_NOTE_KEY)).toBeNull();
  });

  it('treats an empty string as nothing rather than as a note called ""', () => {
    localStorage.setItem(LAST_NOTE_KEY, '');
    expect(readLastNoteId()).toBeNull();
  });
});

describe('the folders that were shut', () => {
  it('come back as the same set', () => {
    rememberCollapsedFolders(new Set(['a', 'b']));
    expect([...readCollapsedFolders()].sort()).toEqual(['a', 'b']);
  });

  it('reads as none when nothing was stored', () => {
    expect(readCollapsedFolders().size).toBe(0);
  });

  it('clears the key rather than storing an empty list', () => {
    rememberCollapsedFolders(new Set(['a']));
    rememberCollapsedFolders(new Set());
    expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();
    expect(readCollapsedFolders().size).toBe(0);
  });

  it('stores the same set as the same bytes, whatever order it is handed in', () => {
    rememberCollapsedFolders(new Set(['b', 'a']));
    const first = localStorage.getItem(COLLAPSED_KEY);
    rememberCollapsedFolders(new Set(['a', 'b']));
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe(first);
  });

  it('ignores a value written by something else', () => {
    localStorage.setItem(COLLAPSED_KEY, '{"folders":["a"]}');
    expect(readCollapsedFolders().size).toBe(0);
  });

  it('ignores bytes that are not JSON at all', () => {
    localStorage.setItem(COLLAPSED_KEY, 'not json');
    expect(readCollapsedFolders().size).toBe(0);
  });

  it('keeps the ids it can use out of a list that also holds junk', () => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(['a', 3, null, '', 'b']));
    expect([...readCollapsedFolders()].sort()).toEqual(['a', 'b']);
  });
});

describe('pruning folders that are gone', () => {
  it('drops ids that no longer name a folder', () => {
    const pruned = pruneCollapsedFolders(new Set(['a', 'gone']), ['a', 'b']);
    expect([...pruned]).toEqual(['a']);
  });

  it('hands back the same set when every id still stands, so nothing re-renders', () => {
    const collapsed = new Set(['a']);
    expect(pruneCollapsedFolders(collapsed, ['a', 'b'])).toBe(collapsed);
  });

  it('empties out when every folder is gone', () => {
    expect(pruneCollapsedFolders(new Set(['a', 'b']), []).size).toBe(0);
  });
});
