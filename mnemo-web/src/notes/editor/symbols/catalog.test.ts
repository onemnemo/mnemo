// @vitest-environment node

/**
 * The catalog is data, and the properties the palette relies on are pinned
 * here rather than trusted: a duplicated name would make a recent ambiguous,
 * a name with a space could never be typed as a token, and a group without a
 * heading key would draw a raw key over its rows.
 */

import { describe, expect, it } from 'vitest';

import { SYMBOL_CATALOG, SYMBOL_GROUP_LABEL_KEY, type SymbolGroup } from './catalog';

function byName(name: string) {
  return SYMBOL_CATALOG.find((entry) => entry.name === name);
}

describe('the symbol catalog', () => {
  it('names every entry once', () => {
    const names = SYMBOL_CATALOG.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every entry a character and a typable name', () => {
    for (const entry of SYMBOL_CATALOG) {
      expect(entry.char.length, entry.name).toBeGreaterThan(0);
      expect(entry.name, entry.name).not.toMatch(/[\s\\]/u);
    }
  });

  it('files every entry under a group with a heading key', () => {
    const groups = new Set<SymbolGroup | 'recent'>(SYMBOL_CATALOG.map((entry) => entry.group));
    for (const group of groups) {
      expect(SYMBOL_GROUP_LABEL_KEY[group]).toMatch(/^SymbolGroup/u);
    }
    expect(SYMBOL_GROUP_LABEL_KEY.recent).toBe('SymbolGroupRecent');
  });

  it('is the size a palette can scan, not a Unicode table', () => {
    expect(SYMBOL_CATALOG.length).toBeGreaterThanOrEqual(200);
    expect(SYMBOL_CATALOG.length).toBeLessThanOrEqual(250);
  });

  it('keeps the groups in the order they are drawn', () => {
    const order: SymbolGroup[] = [];
    for (const entry of SYMBOL_CATALOG) {
      if (order[order.length - 1] !== entry.group) order.push(entry.group);
    }
    expect(order).toEqual([
      'greek',
      'operators',
      'relations',
      'arrows',
      'fractions',
      'currency',
      'typography',
    ]);
  });

  it('spells the LaTeX names', () => {
    expect(byName('infty')?.char).toBe('∞');
    expect(byName('inf')).toBeUndefined();
    expect(byName('degree')?.char).toBe('°');
    expect(byName('deg')).toBeUndefined();
    expect(byName('euro')?.char).toBe('€');
    expect(byName('EUR')).toBeUndefined();
    expect(byName('USD')).toBeUndefined();
    expect(byName('tilde')).toBeUndefined();
  });

  it('follows LaTeX on the variant Greek letters', () => {
    expect(byName('epsilon')?.char).toBe(String.fromCharCode(0x03f5));
    expect(byName('varepsilon')?.char).toBe(String.fromCharCode(0x03b5));
    expect(byName('phi')?.char).toBe(String.fromCharCode(0x03d5));
    expect(byName('varphi')?.char).toBe(String.fromCharCode(0x03c6));
    expect(byName('vartheta')?.char).toBe(String.fromCharCode(0x03d1));
  });

  it('carries the two dashes the house style never types', () => {
    expect(byName('endash')?.char).toBe(String.fromCharCode(0x2013));
    expect(byName('emdash')?.char).toBe(String.fromCharCode(0x2014));
  });

  it('lists the precomposed fractions by the name that types them', () => {
    expect(byName('1/2')?.char).toBe('½');
    expect(byName('3/4')?.char).toBe('¾');
    expect(byName('1/2')?.group).toBe('fractions');
  });

  it('offers no raised or lowered digit, which is a mark and not a character', () => {
    for (const entry of SYMBOL_CATALOG) {
      expect(entry.name, entry.name).not.toMatch(/^[\^_]/u);
    }
  });
});
