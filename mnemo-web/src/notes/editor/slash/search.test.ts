/**
 * The slash menu's matcher. Pure, so it is tested without a document: what a
 * query finds is a property of the strings, and proving it here means the
 * plugin's own tests can be about the menu rather than about spelling.
 */

import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeSearchText, searchCandidates } from './search';

describe('normalizeSearchText', () => {
  it('lower cases', () => {
    expect(normalizeSearchText('Numbered List')).toBe('numbered list');
  });

  it('drops accents rather than treating them as different letters', () => {
    // The same word in both Unicode encodings, precomposed and decomposed.
    expect(normalizeSearchText('Équation')).toBe('equation');
    expect(normalizeSearchText('Équation')).toBe('equation');
  });

  it('turns punctuation into a single space, so "to-do" and "to do" agree', () => {
    expect(normalizeSearchText('to-do')).toBe('to do');
    expect(normalizeSearchText('to   do')).toBe('to do');
    expect(normalizeSearchText('[]')).toBe('');
  });

  it('keeps digits, so a hint like "1." is searchable as "1"', () => {
    expect(normalizeSearchText('1.')).toBe('1');
  });

  it('answers empty for whitespace', () => {
    expect(normalizeSearchText('   ')).toBe('');
  });
});

describe('matchesQuery', () => {
  const heading = searchCandidates(['Heading 1', 'Large section heading', '#', 'heading']);
  const bullet = searchCandidates(['Bullet List', 'Simple bulleted list', '-', 'bulletItem']);

  it('an empty query matches everything, the menu opens showing all rows', () => {
    expect(matchesQuery(heading, '')).toBe(true);
    expect(matchesQuery(bullet, '')).toBe(true);
  });

  it('matches a substring anywhere in a candidate, not just a prefix', () => {
    expect(matchesQuery(bullet, 'list')).toBe(true);
  });

  it('finds a row through its description, which is never drawn', () => {
    expect(matchesQuery(bullet, 'bulleted')).toBe(true);
  });

  it('ignores case and punctuation on both sides', () => {
    expect(matchesQuery(heading, 'HEADING')).toBe(true);
    expect(matchesQuery(bullet, 'bullet-list')).toBe(true);
  });

  it('reads a digit and its word as the same token, in both directions', () => {
    expect(matchesQuery(heading, 'heading one')).toBe(true);
    const spelled = searchCandidates(['Heading One']);
    expect(matchesQuery(spelled, 'heading 1')).toBe(true);
  });

  it('says no when nothing contains the query', () => {
    expect(matchesQuery(heading, 'table')).toBe(false);
    expect(matchesQuery(bullet, 'zzz')).toBe(false);
  });
});

describe('searchCandidates', () => {
  it('skips absent sources rather than matching everything on an empty string', () => {
    // A row with no hint must not become findable by the empty string, which
    // every query contains.
    expect(searchCandidates(['Text', undefined, ''])).toEqual(['text']);
  });

  it('deduplicates, so a label repeated as a keyword costs nothing', () => {
    expect(searchCandidates(['Quote', 'quote', 'QUOTE'])).toEqual(['quote']);
  });
});
