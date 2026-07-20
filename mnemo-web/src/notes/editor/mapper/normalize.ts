/**
 * The legacy normalization pass, run **before** anything reaches ProseMirror.
 *
 * Notes on disk were written by several earlier versions, and PM's `fromJSON`
 * is unforgiving by design: a shape the schema does not describe throws, and a
 * throw here means a note the user cannot open. So every shape correction
 * happens on the plain model, where it is testable without a schema and where a
 * failure is a value we can inspect rather than an exception.
 *
 * This pass is deliberately conservative. It fixes shapes that are
 * *unambiguously* repairable and reports everything else as invalid rather than
 * guessing — a note that reaches quarantine keeps its original bytes and can be
 * exported, whereas a note that was silently "repaired" into the wrong shape has
 * lost data with no record that it happened.
 */

import type { Block, BlockPayload, BlockType } from '../../model/types';
import { plainSpan } from '../../model/spans';

/**
 * The one payload kind each block type may carry, beyond `empty`.
 *
 * Exhaustive by construction: adding an eighteenth `BlockType` without deciding
 * its payload is a compile error rather than a silently unchecked type.
 */
const payloadKindFor = {
  Text: 'empty',
  Heading1: 'empty',
  Heading2: 'empty',
  Heading3: 'empty',
  Heading4: 'empty',
  BulletList: 'empty',
  NumberedList: 'empty',
  Checklist: 'checklist',
  Quote: 'empty',
  Code: 'code',
  Divider: 'empty',
  Image: 'image',
  ColumnGroup: 'empty',
  TwoColumn: 'twoColumn',
  Equation: 'equation',
  Page: 'page',
  Sketch: 'sketch',
} satisfies Record<BlockType, BlockPayload['kind']>;

export interface NormalizeIssue {
  /** Path to the offending block, as indices from the document root. */
  readonly path: readonly number[];
  readonly blockId: string;
  readonly code:
    | 'two-column-arity'
    | 'two-column-cell-type'
    | 'unknown-type'
    | 'payload-type-mismatch';
  readonly detail: string;
}

export interface NormalizeResult {
  readonly blocks: readonly Block[];
  /** Non-empty means the document cannot be mapped and must be quarantined. */
  readonly issues: readonly NormalizeIssue[];
}

export function normalizeBlocks(blocks: readonly Block[]): NormalizeResult {
  const issues: NormalizeIssue[] = [];
  const normalized = blocks.map((block, index) => normalizeBlock(block, [index], issues));
  return { blocks: normalized, issues };
}

function normalizeBlock(
  block: Block,
  path: readonly number[],
  issues: NormalizeIssue[],
): Block {
  const children = block.children?.map((child, index) =>
    normalizeBlock(child, [...path, index], issues),
  );

  // The C# reader and writer never cross-validate `Type` against `Payload.kind`,
  // so the wire format permits them to disagree. The PM schema cannot: each
  // module decomposes the payload into its own typed attrs, and a payload of the
  // wrong kind has nowhere to live, so it would be silently dropped on the first
  // save. Reporting it is the difference between a note the user can export and
  // repair, and one that quietly comes back with a field missing.
  //
  // `empty` is not a mismatch. It is the wire format's "no payload" sentinel and
  // legacy blocks of every type carry it.
  const expected = payloadKindFor[block.type];
  if (block.payload.kind !== 'empty' && block.payload.kind !== expected) {
    issues.push({
      path,
      blockId: block.id,
      code: 'payload-type-mismatch',
      detail: `${block.type} carries a ${block.payload.kind} payload, expected ${expected} or empty`,
    });
  }

  if (block.type === 'TwoColumn') {
    // Three C# readers index `Children[0]` and `Children[1]` positionally, so a
    // TwoColumn with any other arity is not a layout variant to be rendered
    // leniently — it is a shape that crashes the other side of the wire. The
    // schema refuses to build it, and inventing or discarding a cell to make it
    // fit would be exactly the silent data change quarantine exists to prevent.
    const cells = children ?? [];
    if (cells.length !== 2) {
      issues.push({
        path,
        blockId: block.id,
        code: 'two-column-arity',
        detail: `expected exactly 2 columns, found ${String(cells.length)}`,
      });
    } else {
      for (const cell of cells) {
        if (cell.type !== 'ColumnGroup') {
          issues.push({
            path,
            blockId: block.id,
            code: 'two-column-cell-type',
            detail: `column cell is ${cell.type}, expected ColumnGroup`,
          });
        }
      }
    }
  }

  return {
    ...block,
    // Mnemo guarantees at least one span per block; PM allows a genuinely empty
    // line. This is the two-line case that reconciles them, and it is the one
    // canonical empty shape — a sole empty, default-styled text span.
    spans: block.spans.length > 0 ? block.spans : [plainSpan('')],
    children: children ?? null,
  };
}
