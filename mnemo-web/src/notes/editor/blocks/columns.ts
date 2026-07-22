/**
 * The two container types: a two-column block and the column cells inside it.
 *
 * **Exactly two columns is enforced by the content expression, not by
 * convention.** Three separate C# readers index `Children[0]` and `Children[1]`
 * positionally, so a `TwoColumn` with one or three cells is not a layout
 * variant, it is a crash. Saying `columnGroup columnGroup` in the schema means
 * no transaction can produce one, rather than every command remembering not to.
 *
 * The wire format is recursive and the schema keeps it that way: a `columnGroup`
 * accepts any block, `twoColumn` included. Deeper imported data therefore
 * renders and round-trips losslessly. What limits nesting is the command set,
 * product commands create at most three levels, because past that the drag and
 * layout affordances stop being usable, and that is a UI decision the
 * persistence format does not need to share.
 */

import type { AnyBlockModule, InvariantContribution } from '../registry/types';
import type { BlockType } from '../../model/types';
import { blockChildrenOf, defineBlock, lineOf, type BlockDeps } from './shared';

/**
 * A column cell must always hold at least one editable block. The schema permits
 * a cell of just its mandatory line, real wire data has such cells and must load,
 * so this is repair, not a structural rule: whenever a transaction empties a
 * cell of its block children, an empty Text block is seeded back so the cell
 * stays a place the caret can land, exactly as the desktop reinserted a
 * placeholder Text on delete and on paste.
 *
 * It runs early (before the cosmetic heading-bold pass) because it moves content;
 * a later invariant then sees the repaired document. Dissolving the split when a
 * cell empties beside a filled one, or collapsing the whole two-column back to a
 * single block, are delete-command behaviours, not this universal net, they land
 * with the two-column editing commands.
 */
const columnNeverEmpty: InvariantContribution = {
  id: 'column.neverEmpty',
  order: 10,
  apply(ctx) {
    const { tr } = ctx;
    const { paragraph, line } = ctx.state.schema.nodes;
    if (!paragraph || !line) return null;

    let touched = false;
    for (const range of ctx.changedRanges) {
      const from = Math.max(0, range.from);
      const to = Math.min(ctx.state.doc.content.size, range.to);
      if (from > to) continue;
      ctx.state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'columnGroup') return true;
        // A cell with block children is fine; keep descending in case a nested
        // one was emptied.
        if (blockChildrenOf(node).length > 0) return true;
        const cellLine = lineOf(node);
        if (!cellLine) return false;
        // Seed the placeholder right after the cell's mandatory line. Map the
        // position through the accumulating transaction so repairs to earlier
        // cells in the same pass do not shift this one out from under us.
        const insertAt = tr.mapping.map(pos + 1 + cellLine.nodeSize);
        tr.insert(insertAt, paragraph.create(null, line.create()));
        touched = true;
        return false;
      });
    }
    return touched ? tr : null;
  },
};

/**
 * The share of the row the left lane takes, derived from the stored ratio for
 * display. An unusable value (0, at or past 1, or non-finite) centres the split
 * rather than collapsing a lane; everything else is held to a visible minimum on
 * each side. The stored attr stays raw for round-trip, so this is the one place
 * the ratio is normalized and only for layout. Mirrors the desktop's
 * ReadSplitRatioFromBlock display rule, whose serializer passes the raw value
 * through untouched.
 */
export function displaySplitRatio(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0 || raw >= 1) return 0.5;
  return Math.min(0.9, Math.max(0.1, raw));
}

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
          {
            'data-two-column': '',
            'data-split': String(node.attrs.splitRatio),
            // The left lane's share, for layout. Kept apart from data-split,
            // which stays the raw stored value the parser reads back.
            style: `--notes-split:${displaySplitRatio(Number(node.attrs.splitRatio))}`,
          },
          0,
        ],
      },
      // The ratio lives on the container and never on a cell. Real notes have
      // been resized, the stored values are not all 0.5, so each keeps its own.
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
      invariants: [columnNeverEmpty],
    },
    deps,
  );
}
