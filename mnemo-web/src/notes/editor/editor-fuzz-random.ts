/**
 * Seeded randomness for the editor operation fuzzer.
 *
 * mulberry32, so one seed reproduces one run exactly. Nothing in the shipped
 * editor imports this; it exists for the harness beside it.
 */

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  /** Picks by relative weight; entries with a weight of zero are never drawn. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
  chance(probability: number): boolean;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number =>
    maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive);

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      return items[int(items.length)];
    },
    weighted<T>(entries: readonly (readonly [T, number])[]): T {
      let total = 0;
      for (const [, weight] of entries) total += weight;
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    chance(probability: number): boolean {
      return next() < probability;
    },
  };
}
