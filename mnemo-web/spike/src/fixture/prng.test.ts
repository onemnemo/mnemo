import { describe, expect, it } from 'vitest'

import { chance, mulberry32, nextFloat, nextInt, pick, shuffle } from './prng'

describe('mulberry32', () => {
  it('is deterministic: the same seed always produces the same stream', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const seqA = Array.from({ length: 20 }, () => a())
    const seqB = Array.from({ length: 20 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('matches a checked-in golden stream, which is what makes it cross-engine', () => {
    // Two builds in one process agreeing proves nothing about V8 versus JavaScriptCore, and
    // every fixture the spike compares arms on is built independently per engine from this
    // stream. Pinned values are the only form of that claim a test can actually check.
    const rng = mulberry32(12345)
    expect(Array.from({ length: 8 }, () => rng())).toEqual([
      0.9797282677609473,
      0.3067522644996643,
      0.484205421525985,
      0.817934412509203,
      0.5094283693470061,
      0.34747186047025025,
      0.07375754183158278,
      0.7663964673411101,
    ])
  })

  it('matches the golden stream for seed 0 too, so a falsy seed is not special-cased away', () => {
    const rng = mulberry32(0)
    expect(Array.from({ length: 4 }, () => rng())).toEqual([
      0.26642920868471265,
      0.0003297457005828619,
      0.2232720274478197,
      0.1462021479383111,
    ])
  })

  it('gives different seeds different streams', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  it('stays within [0, 1) over many draws', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 5000; i += 1) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('does not repeat trivially over a short run', () => {
    // A broken LCG-style bug can collapse to a short cycle; this is not a proof of a long
    // period, just a cheap smoke test that the state is actually advancing.
    const rng = mulberry32(99)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i += 1) seen.add(rng())
    expect(seen.size).toBe(1000)
  })

  it('normalizes non-uint32 seeds via >>> 0 rather than producing NaN', () => {
    const rng = mulberry32(-1)
    expect(Number.isFinite(rng())).toBe(true)
  })
})

describe('nextInt', () => {
  it('is inclusive of both endpoints', () => {
    const rng = mulberry32(1)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i += 1) seen.add(nextInt(rng, 0, 2))
    expect([...seen].sort()).toEqual([0, 1, 2])
  })

  it('handles a single-value range', () => {
    const rng = mulberry32(1)
    expect(nextInt(rng, 5, 5)).toBe(5)
  })

  it('throws when max is below min', () => {
    const rng = mulberry32(1)
    expect(() => nextInt(rng, 5, 4)).toThrow(/max/)
  })
})

describe('nextFloat', () => {
  it('stays within [min, max)', () => {
    const rng = mulberry32(3)
    for (let i = 0; i < 500; i += 1) {
      const value = nextFloat(rng, 10, 20)
      expect(value).toBeGreaterThanOrEqual(10)
      expect(value).toBeLessThan(20)
    }
  })

  it('throws when max is below min', () => {
    const rng = mulberry32(1)
    expect(() => nextFloat(rng, 5, 4)).toThrow(/max/)
  })
})

describe('chance', () => {
  it('always returns false at probability 0 and true at probability 1', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 50; i += 1) expect(chance(rng, 0)).toBe(false)
    for (let i = 0; i < 50; i += 1) expect(chance(rng, 1)).toBe(true)
  })
})

describe('pick', () => {
  it('only ever returns items from the source array', () => {
    const rng = mulberry32(42)
    const items = ['a', 'b', 'c', 'd']
    for (let i = 0; i < 200; i += 1) {
      expect(items).toContain(pick(rng, items))
    }
  })

  it('throws on an empty array instead of returning undefined', () => {
    const rng = mulberry32(1)
    expect(() => pick(rng, [])).toThrow(/empty/)
  })
})

describe('shuffle', () => {
  it('is a permutation: same multiset of elements, same length', () => {
    const rng = mulberry32(5)
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const shuffled = shuffle(rng, [...items])
    expect(shuffled).toHaveLength(items.length)
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
  })

  it('is deterministic for a given seed', () => {
    const items = Array.from({ length: 30 }, (_, i) => i)
    const a = shuffle(mulberry32(77), [...items])
    const b = shuffle(mulberry32(77), [...items])
    expect(a).toEqual(b)
  })

  it('actually reorders a reasonably sized array', () => {
    // Not a rigorous randomness test, just a guard against a shuffle that silently no-ops.
    const items = Array.from({ length: 50 }, (_, i) => i)
    const shuffled = shuffle(mulberry32(11), [...items])
    expect(shuffled).not.toEqual(items)
  })

  it('mutates and returns the same array reference', () => {
    const items = [1, 2, 3]
    const result = shuffle(mulberry32(1), items)
    expect(result).toBe(items)
  })
})
