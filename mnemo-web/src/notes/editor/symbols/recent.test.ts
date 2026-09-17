// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RECENT_SYMBOL_LIMIT, readRecentSymbols, rememberSymbol } from './recent';

const STORAGE_KEY = 'mnemo.symbols.recent';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readRecentSymbols', () => {
  it('is empty before anything is picked', () => {
    expect(readRecentSymbols()).toEqual([]);
  });

  it('ignores a value written by something else', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'a list' }));
    expect(readRecentSymbols()).toEqual([]);
  });

  it('ignores unparsable content rather than throwing into the palette', () => {
    localStorage.setItem(STORAGE_KEY, '{oh no');
    expect(readRecentSymbols()).toEqual([]);
  });

  it('drops members that are not names', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['alpha', 7, null, '', 'pi']));
    expect(readRecentSymbols()).toEqual(['alpha', 'pi']);
  });

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRecentSymbols()).toEqual([]);
  });
});

describe('rememberSymbol', () => {
  it('puts the latest pick first and returns the list', () => {
    expect(rememberSymbol('alpha')).toEqual(['alpha']);
    expect(rememberSymbol('pi')).toEqual(['pi', 'alpha']);
    expect(readRecentSymbols()).toEqual(['pi', 'alpha']);
  });

  it('moves a repeat pick to the front rather than listing it twice', () => {
    rememberSymbol('alpha');
    rememberSymbol('pi');
    expect(rememberSymbol('alpha')).toEqual(['alpha', 'pi']);
  });

  it('keeps the list to the limit', () => {
    for (let i = 0; i < RECENT_SYMBOL_LIMIT + 3; i++) rememberSymbol(`s${String(i)}`);
    const recent = readRecentSymbols();
    expect(recent).toHaveLength(RECENT_SYMBOL_LIMIT);
    expect(recent[0]).toBe(`s${String(RECENT_SYMBOL_LIMIT + 2)}`);
  });

  it('still answers with the new list when the store refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(rememberSymbol('alpha')).toEqual(['alpha']);
  });
});
