/**
 * GFM pipe tables for the paste reader: a header row, a delimiter row with as many
 * cells, then body rows while lines keep holding a pipe. The outer pipes are optional.
 */

/** One delimiter cell: dashes, with the colons that mark alignment, which are dropped. */
const DELIMITER_CELL = /^:?-+:?$/;

/** Whether the line holds a pipe no backslash escapes. */
function hasCellPipe(line: string): boolean {
  for (let k = 0; k < line.length; k++) {
    if (line[k] === '\\') k++;
    else if (line[k] === '|') return true;
  }
  return false;
}

/**
 * The cells of one pipe table row. A backslash escapes the character after it, so only
 * an unescaped pipe ends a cell; the escapes stay for the inline parser.
 */
export function splitPipeRow(row: string): string[] {
  const body = row.trim();
  const cells: string[] = [];
  let current = '';
  let endsWithSeparator = false;
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    endsWithSeparator = false;
    if (ch === '\\' && k + 1 < body.length) {
      current += ch + body[k + 1];
      k++;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
      endsWithSeparator = true;
    } else {
      current += ch;
    }
  }
  if (!endsWithSeparator) cells.push(current.trim());
  if (body.startsWith('|') && cells.length > 0) cells.shift();
  return cells.map(unescapeCodePipes);
}

/**
 * A cell's escaped pipes inside code spans made literal. GFM unescapes `\|` in the whole
 * cell before inline parsing; outside code the inline parser does that itself, but a
 * code span keeps its backslashes, so a copied `c|d` would read back as `c\|d`.
 */
export function unescapeCodePipes(cell: string): string {
  let out = '';
  let k = 0;
  while (k < cell.length) {
    if (cell[k] === '\\') {
      out += cell.slice(k, k + 2);
      k += 2;
      continue;
    }
    if (cell[k] !== '`') {
      out += cell[k];
      k += 1;
      continue;
    }
    let end = k;
    while (end < cell.length && cell[end] === '`') end += 1;
    const ticks = cell.slice(k, end);
    const close = closingRun(cell, ticks.length, end);
    if (close < 0) {
      out += ticks;
      k = end;
      continue;
    }
    const code = cell.slice(end, close).replace(/(\\+)\|/g, (match, run: string) =>
      run.length % 2 === 1 ? `${run.slice(1)}|` : match,
    );
    out += ticks + code + ticks;
    k = close + ticks.length;
  }
  return out;
}

/** Where a run of exactly `length` backticks starts at or after `from`, or -1. */
function closingRun(text: string, length: number, from: number): number {
  let k = from;
  while (k < text.length) {
    if (text[k] !== '`') {
      k += 1;
      continue;
    }
    let end = k;
    while (end < text.length && text[end] === '`') end += 1;
    if (end - k === length) return k;
    k = end;
  }
  return -1;
}

/**
 * The table opening at `index`, or null: the header row needs a pipe and the delimiter
 * row as many cells as it has, so prose that merely holds a pipe stays prose.
 */
export function readPipeTable(
  lines: readonly string[],
  index: number,
): { rows: string[][]; next: number } | null {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (delimiter === undefined || !hasCellPipe(header) || !hasCellPipe(delimiter)) return null;
  const delimiterCells = splitPipeRow(delimiter);
  if (!delimiterCells.every((cell) => DELIMITER_CELL.test(cell))) return null;
  const headerCells = splitPipeRow(header);
  if (headerCells.length !== delimiterCells.length) return null;

  const rows: string[][] = [headerCells];
  let next = index + 2;
  while (next < lines.length && lines[next].trim() !== '' && hasCellPipe(lines[next])) {
    rows.push(splitPipeRow(lines[next]));
    next++;
  }
  return { rows, next };
}
