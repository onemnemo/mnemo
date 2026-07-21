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
import { defineBlock, lineOf, metrics, wrappedHeight, type BlockDeps } from './shared';
import type { InvariantContribution } from '../registry/types';
import { markdownShortcutTriggers } from '../commands/markdown-shortcuts';

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
      // The markdown block shortcuts all launch from a paragraph, so the whole
      // set rides the paragraph module's triggers — which is what the input
      // plugin's per-block filter keys on.
      inputTriggers: markdownShortcutTriggers(),
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

/**
 * A heading's text is always bold — a real `strong` mark on every run, not a
 * font-weight the theme paints, because it has to survive a copy out of the
 * heading and round-trip through the wire the same way the desktop editor's
 * `EnsureHeadingBold` did. The desktop re-applied it in every setter that could
 * touch a heading's spans; here it is one range-local reaction to whatever a
 * transaction changed.
 *
 * Force-add only. Stripping bold when a block *leaves* a heading is the
 * conversion command's job, not this rule's: a plain paragraph may legitimately
 * be bold, so nothing reacting to the paragraph alone could know the bold was a
 * heading's and should go. `addMark` adds only where the mark is missing, so a
 * heading already fully bold produces no step and the pipeline treats the pass
 * as a no-op.
 */
const forceHeadingBold: InvariantContribution = {
  id: 'heading.forceBold',
  // After the structural invariants (which move content between containers), so
  // this marks the text in its final place rather than a position that a later
  // unwrap would shift out from under it.
  order: 20,
  apply(ctx) {
    const strong = ctx.state.schema.marks.strong;
    if (!strong) return null;
    const { tr } = ctx;
    let touched = false;
    for (const range of ctx.changedRanges) {
      const from = Math.max(0, range.from);
      const to = Math.min(ctx.state.doc.content.size, range.to);
      if (from > to) continue;
      ctx.state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'heading') return true;
        const line = lineOf(node);
        if (!line || line.content.size === 0) return false;
        // The heading opens at `pos`, its line one position in, the line's
        // content one more — so inline text begins at `pos + 2`. Map through the
        // accumulating transaction in case an earlier invariant already shifted
        // the document under us.
        const start = tr.mapping.map(pos + 2);
        const end = tr.mapping.map(pos + 2 + line.content.size);
        if (end > start) {
          tr.addMark(start, end, strong.create());
          touched = true;
        }
        return false;
      });
    }
    return touched ? tr : null;
  },
};

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
      invariants: [forceHeadingBold],
    },
    deps,
  );
}
