import { describe, expect, it } from 'vitest';
import {
  blockSidLength,
  isWellFormedBlockSid,
  isWellFormedNoteSid,
  mintSid,
  noteSidLength,
  sidAlphabet,
} from './sid';

/** A deterministic byte stream, so a mint test asserts a value rather than a shape. */
function bytes(...values: number[]) {
  let i = 0;
  return (out: Uint8Array) => {
    for (let n = 0; n < out.length; n += 1) {
      out[n] = values[i % values.length];
      i += 1;
    }
  };
}

describe('the frozen sid contract', () => {
  it('has the alphabet and lengths the C# side minted real ids with', () => {
    // These are backfilled into user data and quoted in chat history. A change
    // here is a data migration, not a refactor.
    expect(sidAlphabet).toBe('23456789abcdefghjkmnpqrstvwxyz');
    expect(blockSidLength).toBe(5);
    expect(noteSidLength).toBe(6);
  });

  it('excludes every confusable character', () => {
    for (const char of '01loiuOLIU') {
      expect(sidAlphabet.includes(char), `${char} is confusable`).toBe(false);
    }
  });
});

describe('isWellFormedSid', () => {
  it('accepts a well-formed id of each kind', () => {
    expect(isWellFormedBlockSid('k7m2q')).toBe(true);
    expect(isWellFormedNoteSid('j4kq7m')).toBe(true);
  });

  it('treats length as a floor so a future widening still validates', () => {
    expect(isWellFormedBlockSid('k7m2qxy')).toBe(true);
  });

  it('rejects anything shorter than the minimum', () => {
    expect(isWellFormedBlockSid('k7m2')).toBe(false);
    expect(isWellFormedNoteSid('k7m2q')).toBe(false);
  });

  it('rejects a character outside the alphabet', () => {
    expect(isWellFormedBlockSid('k7m2o')).toBe(false);
    expect(isWellFormedBlockSid('k7m2Q')).toBe(false);
  });

  it('rejects null, undefined and the empty string', () => {
    expect(isWellFormedBlockSid(null)).toBe(false);
    expect(isWellFormedBlockSid(undefined)).toBe(false);
    expect(isWellFormedBlockSid('')).toBe(false);
  });
});

describe('mintSid', () => {
  it('mints a well-formed id of the requested length', () => {
    const sid = mintSid(new Set());
    expect(sid).toHaveLength(blockSidLength);
    expect(isWellFormedBlockSid(sid)).toBe(true);
  });

  it('maps bytes onto the alphabet by index', () => {
    expect(mintSid(new Set(), 5, bytes(0, 1, 2, 3, 4))).toBe('23456');
  });

  it('discards a byte that would bias the alphabet rather than folding it in', () => {
    // 240 is the first byte at or above the unbiased ceiling. Folding it in
    // with `%` would emit '2' and quietly make the first 16 characters likelier.
    expect(mintSid(new Set(), 2, bytes(240, 250, 5, 6))).toBe('78');
  });

  it('never returns an id already taken', () => {
    // The first two draws are taken, so it must reject both and keep going.
    const sid = mintSid(new Set(['23456', '34567']), 5, bytes(0, 1, 2, 3, 4, 1, 2, 3, 4, 5, 2, 3, 4, 5, 6));
    expect(sid).toBe('45678');
  });

  it('throws rather than spinning forever when the space is exhausted', () => {
    // A single-character alphabet position can only ever produce one id.
    expect(() => mintSid(new Set(['2']), 1, bytes(0))).toThrow(/could not mint a unique/);
  });

  it('produces every alphabet character over enough draws', () => {
    // Guards the modulo path: a wrong ceiling silently shrinks the id space,
    // which no single-value assertion would catch.
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) {
      for (const char of mintSid(new Set())) seen.add(char);
    }
    expect(seen.size).toBe(sidAlphabet.length);
  });
});
