/**
 * The fold and the diff the editor uses to decide which underlines a word list
 * change touches. Both directions of the diff matter: an addition takes an
 * underline away, a removal puts one back.
 */

import { describe, expect, it } from 'vitest';

import { changedWords, foldWord } from './words';

describe('foldWord', () => {
  it('folds case, surrounding space and the accent encoding the way the host does', () => {
    expect(foldWord('  Sillage ')).toBe('sillage');
    // e followed by a combining acute, and the precomposed e-acute, are one word.
    expect(foldWord('café')).toBe('café');
    expect(foldWord('CAFÉ')).toBe('café');
  });
});

describe('changedWords', () => {
  it('reports what was added and what was removed, folded', () => {
    expect(changedWords(['Alpha', 'beta'], ['beta', 'Gamma'])).toEqual(['alpha', 'gamma']);
  });

  it('reports nothing when the two lists differ only in case or spacing', () => {
    expect(changedWords(['Alpha', ' beta'], ['alpha', 'beta '])).toEqual([]);
  });

  it('treats an empty list as everything gone or everything new', () => {
    expect(changedWords(['alpha'], [])).toEqual(['alpha']);
    expect(changedWords([], ['alpha'])).toEqual(['alpha']);
    expect(changedWords([], [])).toEqual([]);
  });

  it('names a word once even when a list carries it twice', () => {
    expect(changedWords(['alpha', 'ALPHA'], [])).toEqual(['alpha']);
  });
});
