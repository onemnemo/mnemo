/**
 * The two container types: a two-column block and the column cells inside it.
 *
 * **Exactly two columns is enforced by the content expression, not by
 * convention.** Three separate C# readers index `Children[0]` and `Children[1]`
 * positionally, so a `TwoColumn` with one or three cells is not a layout
 * variant — it is a crash. Saying `columnGroup columnGroup` in the schema means
 * no transaction can produce one, rather than every command remembering not to.
 *
 * The wire format is recursive and the schema keeps it that way: a `columnGroup`
 * accepts any block, `twoColumn` included. Deeper imported data therefore
 * renders and round-trips losslessly. What limits nesting is the command set —
 * product commands create at most three levels, because past that the drag and
 * layout affordances stop being usable — and that is a UI decision the
 * persistence format does not need to share.
 */

import type { AnyBlockModule } from '../registry/types';
import type { BlockType } from '../../model/types';
import { blockChildrenOf, defineBlock, type BlockDeps } from './shared';

export function twoColumnBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{ splitRatio: number }>(
    {
      nodeName: 'twoColumn',
      wireTypes: ['TwoColumn'],
      content: 'line columnGroup columnGroup',
      attrs: { splitRatio: { default: 0.5 } },
      nodeOptions: {
        isolating: true,
        parseDOM: [
          {
            tag: 'div[data-two-column]',
            getAttrs: (n) => ({
              splitRatio: Number((n as HTMLElement).getAttribute('data-split')) || 0.5,
            }),
          },
        ],
        toDOM: (node) => [
          'div',
          { 'data-two-column': '', 'data-split': String(node.attrs.splitRatio) },
          0,
        ],
      },
      // The ratio lives on the container and never on a cell. Real notes have
      // been resized — the stored values are not all 0.5 — so each keeps its own.
      attrsFrom: (block) => ({
        splitRatio: block.payload.kind === 'twoColumn' ? block.payload.splitRatio : 0.5,
      }),
      wireFrom: (node) => {
        // `|| 0.5` would be wrong here: 0 is falsy, and a stored ratio of 0 is a
        // value the C# reader passes through untouched rather than defaulting.
        // Only a genuinely unusable value falls back.
        const raw = Number(node.attrs.splitRatio);
        return {
          type: 'TwoColumn' as BlockType,
          payload: {
            kind: 'twoColumn' as const,
            splitRatio: Number.isFinite(raw) ? raw : 0.5,
          },
        };
      },
      toMarkdown: (node, ctx) => ctx.serializeChildren(node),
      // A column's height is the taller lane, not the sum of both.
      estimate: (node, ctx) => {
        let tallest = 0;
        for (const child of blockChildrenOf(node)) {
          tallest = Math.max(tallest, ctx.estimateChild(child));
        }
        return tallest;
      },
    },
    deps,
  );
}

export function columnGroupBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock(
    {
      nodeName: 'columnGroup',
      wireTypes: ['ColumnGroup'],
      // `line block*` rather than `block+`: the mandatory line already makes a
      // cell impossible to empty, and requiring a child block as well would
      // reject a cell that legitimately has none on the wire. Keeping a cell
      // usefully non-empty in the editor is placeholder repair, which is an
      // invariant, not a schema rule that could refuse to load real data.
      nodeOptions: {
        isolating: true,
        parseDOM: [{ tag: 'div[data-column]' }],
        toDOM: () => ['div', { 'data-column': '' }, 0],
      },
      attrsFrom: () => ({}),
      wireFrom: () => ({ type: 'ColumnGroup' as BlockType, payload: { kind: 'empty' as const } }),
      toMarkdown: (node, ctx) => ctx.serializeChildren(node),
    },
    deps,
  );
}
