// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { SYMBOL_CATALOG, type SymbolEntry } from './catalog';
import { searchSymbols, symbolByName } from './search';

const FRACTION_SLASH = String.fromCharCode(0x2044);

function names(query: string, recents?: readonly string[]): string[] {
  return searchSymbols(query, { recents }).map((hit) => hit.entry.name);
}

describe('an empty query', () => {
  it('lists the whole catalog in its own order', () => {
    const hits = searchSymbols('');
    expect(hits.map((hit) => hit.entry)).toEqual([...SYMBOL_CATALOG]);
    expect(hits.every((hit) => hit.group === hit.entry.group)).toBe(true);
  });

  it('puts the recents first, under their own heading, most recent first', () => {
    const hits = searchSymbols('', { recents: ['pi', 'alpha'] });
    expect(hits.slice(0, 2).map((hit) => hit.entry.name)).toEqual(['pi', 'alpha']);
    expect(hits.slice(0, 2).every((hit) => hit.group === 'recent')).toBe(true);
    expect(hits[2]?.entry.name).toBe('alpha');
    expect(hits[2]?.group).toBe('greek');
  });

  it('drops a recent nothing answers to any more', () => {
    expect(names('', ['gone', 'alpha']).slice(0, 2)).toEqual(['alpha', 'alpha']);
  });

  it('remembers a fraction that was rendered on the spot', () => {
    const hits = searchSymbols('', { recents: ['5/7'] });
    expect(hits[0]?.entry.char).toBe(`⁵${FRACTION_SLASH}₇`);
    expect(hits[0]?.group).toBe('recent');
  });

  it('treats whitespace as empty', () => {
    expect(searchSymbols('  ')).toHaveLength(SYMBOL_CATALOG.length);
  });
});

describe('ranking', () => {
  it('an exact name comes first, ahead of the names it prefixes', () => {
    expect(names('in')[0]).toBe('in');
    expect(names('in')).toContain('infty');
    expect(names('int')[0]).toBe('int');
  });

  it('case decides between an exact upper and lower name, and both are found', () => {
    expect(names('Omega').slice(0, 2)).toEqual(['Omega', 'omega']);
    expect(names('omega').slice(0, 2)).toEqual(['omega', 'Omega']);
  });

  it('an exact alias outranks a name prefix, so the short LaTeX forms work', () => {
    expect(names('le')[0]).toBe('leq');
    expect(names('ge')[0]).toBe('geq');
    expect(names('ne')[0]).toBe('neq');
    expect(names('ldots')[0]).toBe('dots');
  });

  it('a word inside an alias finds the row', () => {
    expect(names('arrow')).toContain('to');
    expect(names('arrow')).toContain('uparrow');
    expect(names('equal')).toContain('neq');
  });

  it('a substring still finds a row, after the better matches', () => {
    const hits = names('rrow');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain('uparrow');
  });

  it('ties keep catalog order', () => {
    // `cdot` by exact alias, `dots` by name prefix, then every row an alias
    // word merely begins with, in the order the catalog lists them.
    const hits = names('dot');
    expect(hits.slice(0, 2)).toEqual(['cdot', 'dots']);
    const rest = hits.slice(2).map((name) => SYMBOL_CATALOG.findIndex((entry) => entry.name === name));
    expect(rest.length).toBeGreaterThan(2);
    expect(rest).toEqual([...rest].sort((a, b) => a - b));
  });

  it('finds nothing for a name nobody has', () => {
    expect(names('zzz')).toEqual([]);
  });
});

describe('fractions', () => {
  it('a precomposed fraction is its catalog row, listed once', () => {
    const hits = names('1/2');
    expect(hits[0]).toBe('1/2');
    expect(hits.filter((name) => name === '1/2')).toHaveLength(1);
  });

  it('any other n/d is rendered on the spot and offered first', () => {
    const hits = searchSymbols('5/7');
    expect(hits[0]?.entry.name).toBe('5/7');
    expect(hits[0]?.entry.char).toBe(`⁵${FRACTION_SLASH}₇`);
    expect(hits[0]?.group).toBe('fractions');
  });

  it('a partial fraction lists the precomposed ones it could become', () => {
    expect(names('1/')).toEqual(['1/2', '1/3', '1/4', '1/8']);
  });

  it('a zero denominator is no fraction', () => {
    expect(names('1/0')).toEqual([]);
  });
});

describe('symbolByName', () => {
  it('resolves a catalog name and a fraction, and nothing else', () => {
    expect(symbolByName('alpha')?.char).toBe('α');
    expect(symbolByName('5/7')?.char).toBe(`⁵${FRACTION_SLASH}₇`);
    expect(symbolByName('nope')).toBeNull();
  });

  it('searches the catalog it is given', () => {
    const catalog: SymbolEntry[] = [{ name: 'x', char: 'y', group: 'greek', aliases: [] }];
    expect(symbolByName('x', catalog)?.char).toBe('y');
    expect(symbolByName('alpha', catalog)).toBeNull();
  });
});
