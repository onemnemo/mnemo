/**
 * The plain prose blocks: paragraph, quote, and the four heading levels.
 *
 * `heading` is the one module that owns more than one wire type. Heading1–4 are
 * four `BlockType` values but one PM node with a `level` attr, which is what
 * lets a level change be an `setNodeMarkup` rather than a delete-and-reinsert
 * that would take the block's `sid` with it.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { AnyBlockModule } from '../registry/types';
import type { BlockType } from '../../model/types';
import { defineBlock, metrics, wrappedHeight, type BlockDeps } from './shared';

const emptyPayload = () => ({ type: 'Text' as BlockType, payload: { kind: 'empty' as const } });

export function paragraphBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock(
    {
      nodeName: 'paragraph',
      wireTypes: ['Text'],
      nodeOptions: { parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
      attrsFrom: () => ({}),
      wireFrom: emptyPayload,
      toMarkdown: (_node, _ctx, inline) => `${inline}\n`,
    },
    deps,
  );
}

export function quoteBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock(
    {
      nodeName: 'quote',
      wireTypes: ['Quote'],
      // Flat, not a wrapping blockquote. A quote is a block type on the wire,
      // not a container, and modelling it as a wrapper would let the user build
      // nesting the storage format cannot express.
      nodeOptions: { parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
      attrsFrom: () => ({}),
      wireFrom: () => ({ type: 'Quote' as BlockType, payload: { kind: 'empty' as const } }),
      toMarkdown: (_node, _ctx, inline) => `> ${inline}\n`,
    },
    deps,
  );
}

const headingTypes: readonly BlockType[] = ['Heading1', 'Heading2', 'Heading3', 'Heading4'];

function headingTypeOf(node: PMNode): BlockType {
  return headingTypes[Number(node.attrs.level) - 1] ?? 'Heading1';
}

export function headingBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{ level: number }>(
    {
      nodeName: 'heading',
      wireTypes: headingTypes,
      attrs: { level: { default: 1 } },
      nodeOptions: {
        defining: true,
        parseDOM: [1, 2, 3, 4].map((level) => ({ tag: `h${String(level)}`, attrs: { level } })),
        toDOM: (node) => [`h${String(node.attrs.level)}`, 0],
      },
      attrsFrom: (block) => {
        const level = headingTypes.indexOf(block.type) + 1;
        return { level: level > 0 ? level : 1 };
      },
      wireFrom: (node) => ({ type: headingTypeOf(node), payload: { kind: 'empty' as const } }),
      wireTypeFrom: headingTypeOf,
      toMarkdown: (node, _ctx, inline) =>
        `${'#'.repeat(Number(node.attrs.level) || 1)} ${inline}\n`,
      estimate: (node: PMNode, ctx, text) => {
        const level = Math.min(4, Math.max(1, Number(node.attrs.level) || 1));
        return wrappedHeight(
          text,
          ctx.availableWidth,
          metrics.headingLineHeight[level],
          metrics.headingCharWidth[level],
        );
      },
    },
    deps,
  );
}
