/**
 * The three node types a table is made of.
 *
 * A table is the only block with a second axis, and the schema is where that
 * fact is made structural rather than conventional: `line tableRow+` and
 * `line tableCell+` mean no transaction can produce a table with no rows or a
 * row with no cells, so nothing downstream has to check.
 *
 * Rows own their cells rather than the table owning a flat map keyed by
 * "row:col". Reordering a row is then a splice instead of a rekey, and a row can
 * never be missing a cell for a column that exists.
 *
 * The cell holds its text in its own line, unlike a column cell, which holds
 * blocks. That is the honest shape for what a cell is: a table cell is a run of
 * prose with marks, not a place to nest a heading and a list. Block children are
 * still permitted so imported data round-trips, and the commands simply never
 * make one.
 *
 * Column widths belong to the table, never to a cell: a column has one width by
 * definition, and storing it per cell makes rows that disagree representable.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { AnyBlockModule, InvariantContribution, MdContext } from '../registry/types';
import type { BlockType } from '../../model/types';
import { blockChildrenOf, defineBlock, lineText, metrics, type BlockDeps } from './shared';
import { containmentInvariant } from './containment';
import { insertTable } from './slash-insert';
import { columnWidths, headerColumnsOf, headerRowsOf, squareUp, TABLE_COL_W } from '../table/model';
import { tableView } from '../table/table-view';

/** Roughly one line of prose plus the cell's padding. */
const ROW_HEIGHT = 34;

/**
 * Pads short rows and trims long ones.
 *
 * Nothing in the command set can leave a table ragged, so this is not a rule the
 * editor has to keep, it is a repair for what arrives: a paste, an older note, an
 * agent edit applied halfway. Every overlay in the view indexes cells by column,
 * and a row one cell short puts the resize handle for column three over the text
 * of column two.
 */
const tableRectangular: InvariantContribution = {
  id: 'table.rectangular',
  // Early, alongside the other repair that moves content, so the cosmetic passes
  // downstream see a settled shape.
  order: 12,
  apply(ctx) {
    const { tr } = ctx;
    let touched = false;
    for (const range of ctx.changedRanges) {
      const from = Math.max(0, range.from);
      const to = Math.min(ctx.state.doc.content.size, range.to);
      if (from > to) continue;
      ctx.state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'table') return true;
        // Squared up as the table stands, not as the edit left it: the
        // containment rule ahead of this one can take a stranded node out from
        // inside a cell, which changes both the shape and the size.
        const at = tr.mapping.map(pos);
        const live = tr.doc.nodeAt(at);
        if (!live || live.type.name !== 'table') return false;
        const repaired = squareUp(live);
        if (repaired) {
          tr.replaceWith(at, at + live.nodeSize, repaired);
          touched = true;
        }
        // A table inside a table is not a shape the commands make, and descending
        // into one would repair it against the outer table's own mapping.
        return false;
      });
    }
    return touched ? tr : null;
  },
};

/**
 * A pipe table.
 *
 * The format has one header row and nothing else, so a table with no header row
 * still gets the delimiter under its first row: the alternative is markdown that
 * no reader parses as a table at all, which loses the structure rather than a
 * display flag. Fills, widths and the header column have no representation and do
 * not survive the trip.
 */
function tableMarkdown(node: PMNode, ctx: MdContext): string {
  const rows = blockChildrenOf(node);
  if (rows.length === 0) return '';
  const width = rows.reduce((widest, row) => Math.max(widest, blockChildrenOf(row).length), 0);
  if (width === 0) return '';

  const lines = rows.map((row) => {
    const cells = blockChildrenOf(row);
    const texts = Array.from({ length: width }, (_unused, index) => {
      const cell = cells[index];
      if (!cell) return '';
      const line = cell.firstChild;
      // A pipe would end the cell and a newline would end the table.
      return (line ? ctx.serializeInline(line) : '')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ')
        .trim();
    });
    return `| ${texts.join(' | ')} |`;
  });

  const delimiter = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  return `${[lines[0], delimiter, ...lines.slice(1)].join('\n')}\n`;
}

export function tableBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{
    columnWidths: number[];
    headerRows: boolean[];
    headerColumns: boolean[];
    fullWidth: boolean;
  }>(
    {
      nodeName: 'table',
      wireTypes: ['Table'],
      content: 'line tableRow+',
      attrs: {
        columnWidths: { default: [] as number[] },
        /** Per row: which rows read as labels (sunken surface, medium weight). Any
         *  row can be one, so this is a flag per row rather than a single toggle. */
        headerRows: { default: [] as boolean[] },
        /** The same, per column, which is how a comparison table is usually built. */
        headerColumns: { default: [] as boolean[] },
        /** Off, the table is capped at its own widths; on, it spans the pane. */
        fullWidth: { default: false },
      },
      nodeOptions: {
        isolating: true,
        parseDOM: [{ tag: 'div[data-table]' }],
        toDOM: () => ['div', { 'data-table': '' }, 0],
      },
      attrsFrom: (block) => ({
        columnWidths: block.payload.kind === 'table' ? block.payload.columnWidths : [],
        headerRows: block.payload.kind === 'table' ? block.payload.headerRows : [],
        headerColumns: block.payload.kind === 'table' ? block.payload.headerColumns : [],
        fullWidth: block.payload.kind === 'table' && block.payload.fullWidth,
      }),
      wireFrom: (node) => ({
        type: 'Table' as BlockType,
        // Read through the reconcilers rather than off the attrs: the stored
        // widths and header flags and the table's actual shape are separate facts
        // that can disagree, and what gets written back has to be the one the view
        // was drawn from, padded and trimmed to the real row and column counts.
        payload: {
          kind: 'table' as const,
          columnWidths: columnWidths(node),
          headerRows: headerRowsOf(node),
          headerColumns: headerColumnsOf(node),
          fullWidth: node.attrs.fullWidth === true,
        },
      }),
      toMarkdown: tableMarkdown,
      realizedView: tableView,
      // The taller of the guess and the measure is not available here, so this is
      // the guess: one line per row. A cell that wraps corrects it on realization.
      estimate: (node) => blockChildrenOf(node).length * ROW_HEIGHT + metrics.blockPaddingY * 2,
      invariants: [tableRectangular],
      slash: [
        {
          label: 'Table',
          description: 'TableDescription',
          icon: 'notes/table',
          group: 'insert',
          insert: insertTable,
        },
      ],
    },
    deps,
  );
}

export function tableRowBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock(
    {
      nodeName: 'tableRow',
      wireTypes: ['TableRow'],
      content: 'line tableCell+',
      nodeOptions: {
        isolating: true,
        parseDOM: [{ tag: 'div[data-table-row]' }],
        toDOM: () => ['div', { 'data-table-row': '' }, 0],
      },
      attrsFrom: () => ({}),
      wireFrom: () => ({ type: 'TableRow' as BlockType, payload: { kind: 'empty' as const } }),
      // The table writes the whole grid, so a row asked on its own writes nothing
      // rather than a stray pipe line in the middle of a document.
      toMarkdown: () => '',
      invariants: [containmentInvariant('tableRow')],
    },
    deps,
  );
}

export function tableCellBlock(deps: BlockDeps): AnyBlockModule {
  return defineBlock<{ fill: string }>(
    {
      nodeName: 'tableCell',
      wireTypes: ['TableCell'],
      attrs: { fill: { default: '' } },
      nodeOptions: {
        isolating: true,
        parseDOM: [
          {
            tag: 'div[data-table-cell]',
            getAttrs: (n) => ({ fill: (n as HTMLElement).getAttribute('data-fill') ?? '' }),
          },
        ],
        toDOM: (node) => [
          'div',
          { 'data-table-cell': '', 'data-fill': String(node.attrs.fill ?? '') },
          0,
        ],
      },
      attrsFrom: (block) => ({
        fill: block.payload.kind === 'tableCell' ? block.payload.fill : '',
      }),
      wireFrom: (node) => ({
        type: 'TableCell' as BlockType,
        payload: { kind: 'tableCell' as const, fill: String(node.attrs.fill ?? '') },
      }),
      // Likewise the table's job; a cell asked on its own is just its text.
      toMarkdown: (_node, _ctx, inline) => inline,
      invariants: [containmentInvariant('tableCell')],
      estimate: (node) =>
        Math.max(
          ROW_HEIGHT,
          Math.ceil(lineText(node).length / Math.max(1, TABLE_COL_W / metrics.bodyCharWidth)) *
            metrics.bodyLineHeight,
        ),
    },
    deps,
  );
}
