/**
 * Column and row boundaries, measured rather than derived.
 *
 * The model holds column widths, so the x positions *could* come from it. Row
 * heights cannot, because a cell that wraps decides its own, and a table set to
 * fit the pane has no pixel widths at all. Reading both off the DOM keeps one
 * source of truth for every overlay and gives the fitted case a free ride
 * instead of a second code path.
 *
 * A `ResizeObserver` rather than a dependency list: typing in a cell changes a
 * row's height without changing the document's shape, and a dependency list
 * alone would leave every overlay one line behind the text under it.
 */

import { useLayoutEffect, useState } from 'react';

export interface TableGrid {
  /** Column boundaries, `cols + 1` of them, starting at 0. */
  readonly x: readonly number[];
  /** Row boundaries, `rows + 1` of them, starting at 0. */
  readonly y: readonly number[];
}

const same = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function useTableGrid(frame: HTMLElement, deps: readonly unknown[]): TableGrid {
  const [grid, setGrid] = useState<TableGrid>({ x: [0], y: [0] });

  useLayoutEffect(() => {
    const read = (): void => {
      const rows = Array.from(frame.querySelectorAll<HTMLElement>('[data-table-row]'));
      if (rows.length === 0) return;

      const firstCells = Array.from(rows[0].querySelectorAll<HTMLElement>('[data-table-cell]'));
      const x = [0];
      for (const cell of firstCells) x.push(x[x.length - 1] + cell.offsetWidth);

      const y = [0];
      for (const row of rows) {
        // The row generates no box of its own (it lays out as `display: contents`),
        // so its height is its tallest cell's.
        const cells = Array.from(row.querySelectorAll<HTMLElement>('[data-table-cell]'));
        let tallest = 0;
        for (const cell of cells) tallest = Math.max(tallest, cell.offsetHeight);
        y.push(y[y.length - 1] + tallest);
      }

      setGrid((prev) => (same(prev.x, x) && same(prev.y, y) ? prev : { x, y }));
    };

    read();
    const observer = new ResizeObserver(read);
    observer.observe(frame);
    frame.querySelectorAll('[data-table-cell]').forEach((cell) => observer.observe(cell));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return grid;
}
