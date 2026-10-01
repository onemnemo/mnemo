/**
 * Pipe tables for the paste reader, the shape the editor's table writer emits:
 * a header row, a delimiter row, then body rows while lines keep starting with a pipe.
 */

import { TABLE_DELIMITER } from './markdown-lines';

/** The cells of one pipe table row, a backslash keeping a pipe literal. */
export function splitPipeRow(row: string): string[] {
  let body = row.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch === '\\' && body[k + 1] === '|') {
      current += '|';
      k++;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * The table opening at `index`, or null when the line is not a pipe row with a
 * delimiter row under it. A lone line starting with a pipe is text, since nothing
 * says it meant to be a grid.
 */
export function readPipeTable(
  lines: readonly string[],
  index: number,
): { rows: string[][]; next: number } | null {
  const trimmed = lines[index].replace(/^\s+/, '');
  if (!trimmed.startsWith('|') || index + 1 >= lines.length || !TABLE_DELIMITER.test(lines[index + 1])) {
    return null;
  }
  const rows: string[][] = [splitPipeRow(trimmed)];
  let next = index + 2;
  while (next < lines.length && lines[next].replace(/^\s+/, '').startsWith('|')) {
    rows.push(splitPipeRow(lines[next]));
    next++;
  }
  return { rows, next };
}
