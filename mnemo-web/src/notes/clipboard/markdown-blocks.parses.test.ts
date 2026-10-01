import { describe, expect, it, vi } from 'vitest';

// Every markdown parse the reader asks for, counted, so a joined paragraph's cost stays one parse.
const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock('../model/markdown', async (original) => {
  const actual = await original<Record<string, unknown>>();
  const counted = Object.entries(actual).map(([name, value]) => [
    name,
    typeof value === 'function'
      ? (...args: unknown[]) => {
          parses.count += 1;
          return (value as (...a: unknown[]) => unknown)(...args);
        }
      : value,
  ]);
  return Object.fromEntries(counted);
});

import { parseMarkdownToBlocks } from './markdown-blocks';

describe('parseMarkdownToBlocks: parse count', () => {
  it('parses a wrapped paragraph of a document once', () => {
    parses.count = 0;
    const blocks = parseMarkdownToBlocks('# T\n\none\ntwo\nthree');
    expect(blocks.map((b) => b.type)).toEqual(['Heading1', 'Text']);
    // The heading and the paragraph, nothing more.
    expect(parses.count).toBe(2);
  });

  it('parses a wrapped list item of a document once', () => {
    parses.count = 0;
    parseMarkdownToBlocks('# T\n\n- one\n  two');
    expect(parses.count).toBe(2);
  });
});
