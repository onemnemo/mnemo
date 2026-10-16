/**
 * Where a block drag wraps two blocks into a new two-column: the left or right edge band of
 * a top-level block. Null leaves the drop to the page. A split needs a sideways move, because
 * a nested block's grip sits inside the band.
 */

import type { Node as PMNode } from 'prosemirror-model';

import type { Point } from '@/lib/dnd/usePointerDrag';

import { containerBlockNames } from '../blocks/shared';
import type { Box } from './resolve-block-reorder';

export const SPLIT_BAND_SHARE = 0.1;
export const SPLIT_BAND_MIN = 52;
export const SPLIT_BAND_MAX = 96;
export const SPLIT_LINE_WIDTH = 2;
/** Horizontal travel from the press before the bands engage. */
export const SPLIT_MIN_TRAVEL = 24;

export type SplitSide = 'left' | 'right';

/** One measured top-level block, in viewport coordinates, with what the document knows of it. */
export interface SplitRow {
  pos: number;
  end: number;
  sid: string;
  type: string;
  top: number;
  bottom: number;
  left: number;
  width: number;
  holdsLayout: boolean;
}

/** The dragged block, wherever it sits. */
export interface SplitSource {
  pos: number;
  end: number;
  type: string;
  /** Inside a table. Only the table moves its own content. */
  inTable: boolean;
  holdsLayout: boolean;
}

export interface SplitTarget {
  kind: 'split';
  pos: number;
  sid: string;
  side: SplitSide;
  line: Box;
}

export interface ResolveSplitInput {
  rows: readonly SplitRow[];
  pointer: Point;
  /** Where the press began. Its x measures the sideways travel. */
  pressX: number;
  source: SplitSource;
}

export function splitBandWidth(width: number): number {
  return Math.min(Math.max(width * SPLIT_BAND_SHARE, SPLIT_BAND_MIN), SPLIT_BAND_MAX, width / 2);
}

const NEVER_SOURCE: ReadonlySet<string> = new Set(['twoColumn', 'columnGroup', 'tableRow', 'tableCell', 'divider']);

/** Layouts would nest, dividers hold no content and table parts belong to their table. */
export function canBeSplitSource(type: string): boolean {
  return !NEVER_SOURCE.has(type);
}

function canBeSplitTarget(type: string): boolean {
  return !containerBlockNames.has(type) && type !== 'divider';
}

/** Whether the block is or holds a layout. A table never holds one. */
export function holdsTwoColumn(node: PMNode): boolean {
  if (node.type.name === 'twoColumn') return true;
  if (node.type.name === 'table') return false;
  let found = false;
  node.forEach((child) => {
    if (!found && child.type.name !== 'line') found = holdsTwoColumn(child);
  });
  return found;
}

/** Pairs a measured rect with the block it belongs to. `pos` is the position before `node`. */
export function splitRowOf(
  node: PMNode,
  pos: number,
  rect: { top: number; bottom: number; left: number; width: number },
): SplitRow {
  return {
    pos,
    end: pos + node.nodeSize,
    sid: String(node.attrs.sid ?? ''),
    type: node.type.name,
    holdsLayout: holdsTwoColumn(node),
    ...rect,
  };
}

/** Whether `pos` sits somewhere inside a table. */
export function insideTable(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'table') return true;
  return false;
}

function sideAt(row: SplitRow, x: number): SplitSide | null {
  const band = splitBandWidth(row.width);
  if (x >= row.left && x < row.left + band) return 'left';
  if (x >= row.left + row.width - band && x < row.left + row.width) return 'right';
  return null;
}

export function resolveBlockSplit(input: ResolveSplitInput): SplitTarget | null {
  const { rows, pointer, source } = input;
  if (Math.abs(pointer.x - input.pressX) < SPLIT_MIN_TRAVEL) return null;
  if (!canBeSplitSource(source.type) || source.inTable || source.holdsLayout) return null;
  const row = rows.find((r) => pointer.y >= r.top && pointer.y < r.bottom);
  if (!row || !canBeSplitTarget(row.type) || row.holdsLayout) return null;
  if (row.pos === source.pos || (source.pos > row.pos && source.pos < row.end)) return null;
  const side = sideAt(row, pointer.x);
  if (!side) return null;

  const x = side === 'left' ? row.left : row.left + row.width;
  const height = row.bottom - row.top;
  const line = { top: row.top, left: x - SPLIT_LINE_WIDTH / 2, width: SPLIT_LINE_WIDTH, height };
  return { kind: 'split', pos: row.pos, sid: row.sid, side, line };
}
