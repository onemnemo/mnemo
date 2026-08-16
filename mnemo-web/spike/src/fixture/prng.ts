/**
 * A seeded PRNG for the fixture generator. Deterministic and identical across engines: the
 * spike compares React Flow, a DOM renderer and Canvas2D against fixtures each engine builds
 * independently from the same seed, so if two engines ever drew different random numbers for
 * the same seed, every cross-engine comparison downstream would be silently meaningless.
 *
 * `Math.random` is unseeded and gives no such guarantee, which is why it is never used here.
 * mulberry32 is chosen instead of something fancier because it is a handful of integer ops
 * with no engine-specific behaviour: everything below is `Math.imul` and 32-bit bitwise
 * arithmetic, which the ECMAScript spec pins down exactly, so the same seed produces the same
 * stream on V8 and JavaScriptCore alike.
 */

export type Rng = () => number

/** Builds a mulberry32 generator from a 32-bit seed. Each call returns a float in [0, 1). */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [min, max], both ends inclusive. */
export function nextInt(rng: Rng, min: number, max: number): number {
  if (max < min) {
    throw new Error(`nextInt: max (${max}) is below min (${min})`)
  }
  return min + Math.floor(rng() * (max - min + 1))
}

/** Float in [min, max). */
export function nextFloat(rng: Rng, min: number, max: number): number {
  if (max < min) {
    throw new Error(`nextFloat: max (${max}) is below min (${min})`)
  }
  return min + rng() * (max - min)
}

/** True with the given probability, 0..1. */
export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability
}

/**
 * Uniformly picks one element. Throws on an empty array rather than returning `undefined`,
 * because a silent `undefined` here would surface many call sites downstream as a confusing
 * "cannot read property of undefined" instead of at the actual cause.
 */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pick: array is empty')
  }
  return items[nextInt(rng, 0, items.length - 1)]
}

/** Fisher-Yates, in place. Returns the same array reference for chaining. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = nextInt(rng, 0, i)
    const tmp = items[i]
    items[i] = items[j]
    items[j] = tmp
  }
  return items
}
