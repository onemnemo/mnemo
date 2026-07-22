/**
 * The outline: how a model sees a note's structure without reading its content.
 *
 * Deliberately not JSON. The same facts wrapped in braces, quotes and repeated
 * key names cost roughly 40% more tokens, and nothing here needs a parser, a
 * model reads fixed columns fine. On a 300-line outline that difference, plus
 * `Heading1` -> `h1`, is the margin between an outline that fits in a small
 * local model's window and one that cannot exist.
 *
 * The C# `outline_note` this replaces emits full enum names and addresses
 * blocks by the first 8 characters of their GUID. Both change here: the codes
 * below are new, and blocks are addressed by `sid`. See `resolve.ts` for why
 * that divergence is deliberate and when it closes.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { BlockRegistry } from '../editor/registry/build';
import { walkBlocks, type BlockEntry } from '../editor/projection/document';
import type { BlockType } from '../model/types';

/**
 * Two characters per block type.
 *
 * `satisfies` rather than a plain annotation so an eighteenth `BlockType`
 * without a code is a compile error. A missing code would otherwise surface as
 * `undefined` in an outline the model then tries to reason about.
 */
export const typeCodes = {
  Text: 'p',
  Heading1: 'h1',
  Heading2: 'h2',
  Heading3: 'h3',
  Heading4: 'h4',
  BulletList: 'ul',
  NumberedList: 'ol',
  Checklist: 'td',
  Quote: 'q',
  Code: 'c',
  Divider: 'hr',
  Image: 'im',
  ColumnGroup: 'cg',
  TwoColumn: '2c',
  Equation: 'eq',
  Page: 'pg',
  Sketch: 'sk',
} satisfies Record<BlockType, string>;

/** Inverse of `typeCodes`, for parsing a `type` op's target. */
export const typeByCode: ReadonlyMap<string, BlockType> = new Map(
  Object.entries(typeCodes).map(([type, code]) => [code, type as BlockType]),
);

export interface OutlineOptions {
  /** Characters of block text per line before truncation. */
  readonly previewLength?: number;
}

const defaultPreviewLength = 80;

/**
 * Renders one line per block, in document order.
 *
 * `sid code [indent]preview (n)`, where `(n)` appears only on a block that has
 * block children. Indentation is inside the preview column so the sid and code
 * columns stay aligned at any depth, a model scanning for an id should not
 * have to find it at a different offset on every line.
 */
export function renderOutline(
  doc: PMNode,
  registry: BlockRegistry,
  options: OutlineOptions = {},
): string {
  const previewLength = options.previewLength ?? defaultPreviewLength;
  const lines = walkBlocks(doc, registry).map((entry) => outlineLine(entry, previewLength));
  return lines.join('\n');
}

function outlineLine(entry: BlockEntry, previewLength: number): string {
  const code = typeCodes[entry.type];
  const indent = '  '.repeat(entry.depth);
  const preview = previewOf(entry, previewLength);
  const children = entry.childCount > 0 ? ` (${String(entry.childCount)})` : '';
  return `${entry.sid} ${code} ${indent}${preview}${children}`.trimEnd();
}

function previewOf(entry: BlockEntry, previewLength: number): string {
  // Newlines would break the one-block-per-line contract the whole format rests
  // on; a multi-line quote or code block is a single outline row.
  const text = entry.module.project.plainText(entry.node).replace(/\s+/g, ' ').trim();
  const truncated =
    text.length > previewLength ? `${text.slice(0, previewLength).trimEnd()}...` : text;

  // Checked state is structural, not decoration: the `type` op folds
  // check/uncheck into a type conversion, so a model cannot decide whether to
  // issue one without seeing the current state here.
  if (entry.type === 'Checklist') {
    const checked = entry.node.attrs.checked === true;
    return `[${checked ? 'x' : ' '}] ${truncated}`.trimEnd();
  }
  return truncated;
}
