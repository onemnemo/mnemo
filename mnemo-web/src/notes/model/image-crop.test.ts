// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { cropsEqual } from './image-crop';

const window = { x: 0.25, y: 0.5, w: 0.25, h: 0.125, aspect: 2 };

describe('cropsEqual', () => {
  it('reads a window and its float round trip as the same window', () => {
    // What a reopened editor hands back after rebuilding its view from the stored numbers and
    // confirming without touching anything. Committing this would spend an undo step on nothing.
    expect(cropsEqual(window, { ...window, x: 0.25 + 1e-9, h: 0.125 - 1e-9 })).toBe(true);
  });

  it('reads a window somebody actually moved as a different one', () => {
    expect(cropsEqual(window, { ...window, x: 0.2501 })).toBe(false);
    expect(cropsEqual(window, { ...window, aspect: 1.5 })).toBe(false);
  });

  it('treats no crop as equal only to no crop', () => {
    expect(cropsEqual(null, null)).toBe(true);
    expect(cropsEqual(window, null)).toBe(false);
    expect(cropsEqual(null, window)).toBe(false);
  });
});
