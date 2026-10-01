import { describe, expect, it } from 'vitest';

import { currentHeadingIndex } from './current-heading';

/** The scan the index chip ran before, kept as the reference answer. */
function linearIndex(tops: readonly number[], threshold: number): number {
  let current = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= threshold) current = i;
    else break;
  }
  return current;
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('currentHeadingIndex', () => {
  it('agrees with a top-to-bottom scan at every offset', () => {
    const random = seeded(7);
    for (let run = 0; run < 50; run++) {
      const tops: number[] = [];
      let y = random() * 200 - 100;
      const count = 1 + Math.floor(random() * 80);
      for (let i = 0; i < count; i++) {
        tops.push(Math.round(y));
        y += Math.floor(random() * 300);
      }
      for (let threshold = tops[0] - 50; threshold <= tops[tops.length - 1] + 50; threshold += 7) {
        expect(currentHeadingIndex(tops.length, (i) => tops[i], threshold)).toBe(linearIndex(tops, threshold));
      }
    }
  });

  it('counts a heading exactly at the threshold as current', () => {
    expect(currentHeadingIndex(3, (i) => [0, 100, 200][i], 100)).toBe(1);
  });

  it('answers the first heading when every heading is below', () => {
    expect(currentHeadingIndex(3, (i) => [50, 100, 200][i], 10)).toBe(0);
  });

  it('answers the last heading when every heading is above', () => {
    expect(currentHeadingIndex(3, (i) => [-300, -200, -100][i], 0)).toBe(2);
  });

  it('handles a single heading and an empty list', () => {
    expect(currentHeadingIndex(1, () => 500, 0)).toBe(0);
    expect(currentHeadingIndex(0, () => 0, 0)).toBe(0);
  });

  it('treats a heading it cannot measure as below', () => {
    // The scan stopped at the first failure; the search only matches it when no
    // later heading measures, which holds because a mounted top-level heading
    // always has DOM to measure.
    const tops = [0, 100, Number.NaN, 300];
    const topOf = (i: number) => {
      if (Number.isNaN(tops[i])) throw new Error('no DOM');
      return tops[i];
    };
    expect(currentHeadingIndex(4, topOf, 150)).toBe(1);
  });
});
