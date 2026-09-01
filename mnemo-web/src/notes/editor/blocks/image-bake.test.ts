// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { bakedImageFileName } from './image-bake';

describe('bakedImageFileName', () => {
  it('names the file after the caption', () => {
    expect(bakedImageFileName('Ventricular action potential', 'Image')).toBe(
      'Ventricular action potential.png',
    );
  });

  it('takes out what a file system would refuse', () => {
    expect(bakedImageFileName('Fig 1: before/after?', 'Image')).toBe('Fig 1_ before_after_.png');
  });

  it('falls back where the caption leaves nothing behind', () => {
    expect(bakedImageFileName('', 'Image')).toBe('Image.png');
    expect(bakedImageFileName('   ', 'Image')).toBe('Image.png');
    expect(bakedImageFileName('...', 'Image')).toBe('Image.png');
  });

  it('keeps the name short enough to save', () => {
    const long = bakedImageFileName('a'.repeat(200), 'Image');
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith('.png')).toBe(true);
  });

  it('does not leave a bare dot before the extension when the cap lands on one', () => {
    // The 60-char cap falls exactly on the dot in the middle of this caption, which is not a
    // leading or trailing dot and so is never touched by the ends-only strip on its own.
    const caption = `${'a'.repeat(59)}.${'b'.repeat(10)}`;
    const named = bakedImageFileName(caption, 'Image');
    expect(named).toBe(`${'a'.repeat(59)}.png`);
    expect(named).not.toContain('..png');
  });
});
