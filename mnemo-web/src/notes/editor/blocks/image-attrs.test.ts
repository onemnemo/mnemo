// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  clampImageWidth,
  IMAGE_SIZE_PRESETS,
  isPresetImageWidth,
  MAX_IMAGE_WIDTH,
  MIN_IMAGE_WIDTH,
  presetImageWidth,
} from './image-attrs';

describe('presetImageWidth', () => {
  it('is a fraction of the column, in whole pixels', () => {
    expect(presetImageWidth(600, 0.25)).toBe(150);
    expect(presetImageWidth(600, 1)).toBe(600);
    expect(presetImageWidth(665, 0.75)).toBe(499);
  });

  it('never lands outside the width a resize could reach', () => {
    expect(presetImageWidth(120, 0.25)).toBe(MIN_IMAGE_WIDTH);
    expect(presetImageWidth(4000, 1)).toBe(MAX_IMAGE_WIDTH);
  });
});

describe('isPresetImageWidth', () => {
  it('reads a width within two percent of the column as that preset', () => {
    expect(isPresetImageWidth(300, 600, 0.5)).toBe(true);
    expect(isPresetImageWidth(306, 600, 0.5)).toBe(true);
    expect(isPresetImageWidth(320, 600, 0.5)).toBe(false);
  });

  it('answers no for a block that was never resized, and for an unmeasurable column', () => {
    expect(isPresetImageWidth(0, 600, 1)).toBe(false);
    expect(isPresetImageWidth(300, 0, 0.5)).toBe(false);
  });

  it('reads the same pixels differently in a different column', () => {
    // Which is why a preset is stored as pixels but chosen as a fraction of what is there now.
    expect(isPresetImageWidth(300, 400, 0.75)).toBe(true);
    expect(isPresetImageWidth(300, 400, 0.5)).toBe(false);
  });

  it('ticks the 25 percent row after its clamped commit, in a column narrower than 320px', () => {
    // A quarter of 250px is 62.5, below the resize floor, so 25 percent commits MIN_IMAGE_WIDTH
    // rather than a quarter of the column. Comparing the raw fraction would never match here.
    const columnWidth = 250;
    const committed = presetImageWidth(columnWidth, 0.25);
    expect(committed).toBe(MIN_IMAGE_WIDTH);
    expect(isPresetImageWidth(committed, columnWidth, 0.25)).toBe(true);
  });
});

describe('the preset list', () => {
  it('offers four quarters of the column and nothing else', () => {
    expect(IMAGE_SIZE_PRESETS.map((preset) => preset.fraction)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(new Set(IMAGE_SIZE_PRESETS.map((preset) => preset.id)).size).toBe(4);
  });
});

describe('clampImageWidth', () => {
  it('holds a stored width to the range the block can draw', () => {
    expect(clampImageWidth(10)).toBe(MIN_IMAGE_WIDTH);
    expect(clampImageWidth(9000)).toBe(MAX_IMAGE_WIDTH);
    expect(clampImageWidth(320.4)).toBe(320);
  });
});
