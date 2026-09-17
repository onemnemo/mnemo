// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { parseFraction, renderFraction } from './fractions';

/** U+2044, spelled by code point so it cannot be mistaken for a plain slash. */
const FRACTION_SLASH = String.fromCharCode(0x2044);

describe('parseFraction', () => {
  it('reads digits either side of a slash', () => {
    expect(parseFraction('1/2')).toEqual({ numerator: 1, denominator: 2 });
    expect(parseFraction('10/100')).toEqual({ numerator: 10, denominator: 100 });
    expect(parseFraction('0/3')).toEqual({ numerator: 0, denominator: 3 });
  });

  it('refuses a zero denominator', () => {
    expect(parseFraction('1/0')).toBeNull();
  });

  it('refuses anything that is not two whole numbers', () => {
    expect(parseFraction('a/b')).toBeNull();
    expect(parseFraction('1/')).toBeNull();
    expect(parseFraction('/2')).toBeNull();
    expect(parseFraction('1.5/2')).toBeNull();
    expect(parseFraction(' 1/2')).toBeNull();
    expect(parseFraction('1/2/3')).toBeNull();
    expect(parseFraction('')).toBeNull();
  });
});

describe('renderFraction', () => {
  it('uses the precomposed glyph where Unicode has one', () => {
    expect(renderFraction({ numerator: 1, denominator: 2 })).toBe('½');
    expect(renderFraction({ numerator: 1, denominator: 3 })).toBe('⅓');
    expect(renderFraction({ numerator: 2, denominator: 3 })).toBe('⅔');
    expect(renderFraction({ numerator: 1, denominator: 4 })).toBe('¼');
    expect(renderFraction({ numerator: 3, denominator: 4 })).toBe('¾');
    expect(renderFraction({ numerator: 1, denominator: 8 })).toBe('⅛');
    expect(renderFraction({ numerator: 3, denominator: 8 })).toBe('⅜');
    expect(renderFraction({ numerator: 5, denominator: 8 })).toBe('⅝');
    expect(renderFraction({ numerator: 7, denominator: 8 })).toBe('⅞');
  });

  it('builds the rest from superscript and subscript digits around the fraction slash', () => {
    expect(renderFraction({ numerator: 5, denominator: 7 })).toBe(`⁵${FRACTION_SLASH}₇`);
    expect(renderFraction({ numerator: 10, denominator: 100 })).toBe(`¹⁰${FRACTION_SLASH}₁₀₀`);
    expect(renderFraction({ numerator: 0, denominator: 3 })).toBe(`⁰${FRACTION_SLASH}₃`);
  });

  it('does not reduce or reinterpret what was typed', () => {
    expect(renderFraction({ numerator: 2, denominator: 4 })).toBe(`²${FRACTION_SLASH}₄`);
  });
});
