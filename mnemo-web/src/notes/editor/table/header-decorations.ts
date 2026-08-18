/**
 * Header cells, painted as decorations rather than written into the cells.
 *
 * Which rows and columns are headers is a table fact (it lives on the table
 * node, aligned to the row and column counts), but the thing that has to *look*
 * like a header is each cell. Rows are DOM elements the stylesheet can reach, so
 * a header row could be pure CSS; a header column cannot, because CSS has no way
 * to select "every cell in columns 1 and 3" for a set that changes per table. So
 * both axes are handled the one way that works for the harder one: a decoration
 * that adds a class to each cell a header row or a header column covers.
 *
 * Nothing here is stored. The class is recomputed from the table's own flags on
 * every document change, so it can never be a stale header left on a row that was
 * deleted or moved. This is the same shape as the numbered-list numbering, and it
 * belongs in both the read and the edit stacks: a header is part of how a note
 * reads, not a thing you can only see while editing.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { headerColumnsOf, headerRowsOf } from './model';

const headerKey = new PluginKey<DecorationSet>('notes-table-headers');

/**
 * A node decoration on every header cell in `doc`. Pure and view-free, so the
 * membership is testable without mounting anything.
 */
export function tableHeaderDecorations(doc: PMNode): Decoration[] {
  const decos: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;
    const headerRows = headerRowsOf(node);
    const headerColumns = headerColumnsOf(node);
    if (!headerRows.some(Boolean) && !headerColumns.some(Boolean)) return false;

    let rowIndex = -1;
    node.forEach((child, childOffset) => {
      if (child.type.name !== 'tableRow') return; // the table's own mandatory line
      rowIndex += 1;
      const row = rowIndex;
      const rowPos = pos + 1 + childOffset;
      let colIndex = -1;
      child.forEach((cell, cellOffset) => {
        if (cell.type.name !== 'tableCell') return; // the row's mandatory line
        colIndex += 1;
        if (headerRows[row] !== true && headerColumns[colIndex] !== true) return;
        const cellPos = rowPos + 1 + cellOffset;
        decos.push(Decoration.node(cellPos, cellPos + cell.nodeSize, { class: 'notes-cell-head' }));
      });
    });
    // A table inside a table is not a shape the schema produces, so there is
    // nothing worth descending into.
    return false;
  });

  return decos;
}

/**
 * Paints the header surface on header cells in both views. Decoration only, so it
 * appends no step and never dirties the note.
 */
export function tableHeaderPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: headerKey,
    state: {
      init: (_config, state) => DecorationSet.create(state.doc, tableHeaderDecorations(state.doc)),
      apply(tr, old, _oldState, newState) {
        if (!tr.docChanged) return old;
        return DecorationSet.create(newState.doc, tableHeaderDecorations(newState.doc));
      },
    },
    props: {
      decorations(this: Plugin<DecorationSet>, state: EditorState) {
        return this.getState(state);
      },
    },
  });
}
