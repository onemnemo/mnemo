/**
 * A cell grid on the OS clipboard.
 *
 * A rectangle of cells is copied as tab separated text (text/plain) and an HTML
 * table (text/html), the two formats a spreadsheet reads, so the same copy pastes
 * back into our own tables and into Excel or Google Sheets as a real grid. A paste
 * reads either one back, preferring the HTML because it keeps a cell's own line
 * breaks that the tab separated form has to flatten to keep its rows and columns.
 *
 * Only these two shapes count as a grid: a real `<table>`, or plain text that
 * actually carries a tab. Ordinary multi line text is not a grid, so pasting a
 * paragraph into a cell still folds in as text rather than spilling across rows
 * nobody asked for.
 */

const TAB = '\t';

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rows joined by newlines, cells by tabs; a cell's own breaks flatten to spaces. */
export function gridToTsv(grid: readonly (readonly string[])[]): string {
  return grid.map((row) => row.map((cell) => cell.replace(/\s*\n\s*/g, ' ')).join(TAB)).join('\n');
}

/** An HTML table for text/html, a cell's own breaks kept as `<br>`. */
export function gridToHtml(grid: readonly (readonly string[])[]): string {
  const rows = grid
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`)
    .join('');
  return `<table><tbody>${rows}</tbody></table>`;
}

/** More than a single cell, i.e. worth spreading across cells rather than folding in as text. */
export function isMultiCell(grid: readonly (readonly string[])[]): boolean {
  if (grid.length === 0) return false;
  return grid.length > 1 || grid[0].length > 1;
}

/** A pasted cell's text, its `<br>` becoming a newline and its stray HTML whitespace trimmed. */
function cellText(cell: Element): string {
  cell.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return (cell.textContent ?? '').replace(/ /g, ' ').trim();
}

/**
 * The first HTML table in `html` as a grid, or null when there is none.
 *
 * Parsed through `DOMParser`, whose document is inert: no script runs and no
 * `src` loads, so reading attacker supplied clipboard HTML for its cell text is
 * safe. Only text is taken; the cells' own markup is not carried into the note.
 */
function parseHtmlTable(html: string): string[][] | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  if (!table) return null;
  const out: string[][] = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll('td, th').forEach((td) => cells.push(cellText(td)));
    if (cells.length > 0) out.push(cells);
  });
  return out.length > 0 ? out : null;
}

/** Tab separated text as a grid: rows by newline, cells by tab. */
function parseTsv(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  // A trailing newline terminates the last row rather than opening an empty one.
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
  return rows.map((row) => row.split(TAB));
}

/**
 * The clipboard's grid, from an HTML table or tab separated text, or null.
 *
 * `fromHtml` tells the caller a real table was on the clipboard, which is the
 * signal a paste outside a table needs before it builds a whole new table: tab
 * separated text alone is too ordinary to promote to one unasked.
 */
export function parseClipboardGrid(data: DataTransfer): { grid: string[][]; fromHtml: boolean } | null {
  const html = data.getData('text/html');
  if (html) {
    const grid = parseHtmlTable(html);
    if (grid) return { grid, fromHtml: true };
  }
  const text = data.getData('text/plain');
  if (text && text.includes(TAB)) return { grid: parseTsv(text), fromHtml: false };
  return null;
}

/**
 * Puts a cell grid on the OS clipboard as tab separated text and an HTML table.
 *
 * The async clipboard API, because it is the one path that can write without a
 * live DOM selection, and a cell rectangle has none: the drag that made it blurred
 * the editor and cleared the range on purpose. Best effort throughout, an engine
 * without the API or a denied permission simply copies nothing, which is what a
 * plain copy of a cell rectangle does today anyway, so there is nothing to lose by
 * failing quietly.
 */
export async function writeGridToClipboard(grid: readonly (readonly string[])[]): Promise<void> {
  const tsv = gridToTsv(grid);
  try {
    const clipboard = navigator.clipboard;
    if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([gridToHtml(grid)], { type: 'text/html' }),
        }),
      ]);
      return;
    }
    await navigator.clipboard?.writeText?.(tsv);
  } catch {
    // No clipboard access (missing API, denied permission, insecure context).
  }
}
