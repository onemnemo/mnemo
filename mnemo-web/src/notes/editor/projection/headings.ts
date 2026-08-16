/**
 * The note's heading outline, the source the floating index chip renders from.
 *
 * Only top-level headings with real text: a heading nested inside a column is
 * structure, not a chapter, and a blank heading is a placeholder a reader has
 * not filled in yet. Built off `walkBlocks` so it shares document order and
 * block positions with every other projection, which is what lets a click on an
 * outline row scroll to a position the editor agrees is that block.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { BlockRegistry } from '../registry/build';
import { walkBlocks } from './document';
import type { BlockType } from '../../model/types';

export type HeadingLevel = 1 | 2 | 3 | 4;

export interface HeadingEntry {
  readonly sid: string;
  /** Absolute position of the heading block, as `getPos()` reports it. */
  readonly pos: number;
  readonly level: HeadingLevel;
  /** Single-line, whitespace-collapsed heading text; never empty. */
  readonly text: string;
}

const headingLevels: Partial<Record<BlockType, HeadingLevel>> = {
  Heading1: 1,
  Heading2: 2,
  Heading3: 3,
  Heading4: 4,
};

export function documentHeadings(doc: PMNode, registry: BlockRegistry): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  for (const entry of walkBlocks(doc, registry)) {
    // Nested headings are structure inside a layout island, not chapters.
    if (entry.depth !== 0) continue;
    const level = headingLevels[entry.type];
    if (level === undefined) continue;

    const text = entry.module.project.plainText(entry.node).replace(/\s+/g, ' ').trim();
    if (text.length === 0) continue;

    out.push({ sid: entry.sid, pos: entry.pos, level, text });
  }
  return out;
}
