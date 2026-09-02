/**
 * A cell grid on the OS clipboard.
 *
 * A rectangle of cells is copied as tab separated text (text/plain) and an HTML
 * table (text/html), the two formats a spreadsheet reads, so the same copy pastes
 * back into our own tables and into Excel or Google Sheets as a real grid. A paste
 * reads either one back, preferring the HTML because it keeps a cell's own line
 * breaks that the tab separated form has to flatten to keep its rows and columns.
 *
 * Only these two shapes count as a grid: a clipboard whose whole content is one
 * data `<table>`, or plain text that actually carries a tab. Ordinary multi line
 * text is not a grid, so pasting a paragraph into a cell still folds in as text
 * rather than spilling across rows nobody asked for.
 */

import { sanitizeExternalHtml } from './html-sanitize';

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
 * Block level tags a data grid's cells never hold, and a layout table's do.
 *
 * A mail client and an older page wrap a whole article in a table for its
 * columns. Reading that as a grid flattens the headings and the lists into cell
 * text, so a table holding any of these is prose that happens to be in a table.
 */
const CELL_STRUCTURE = 'h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, hr, figure';

/** Whether `table` is a grid of values rather than an article laid out in cells. */
export function isDataTable(table: Element): boolean {
  return table.querySelector(CELL_STRUCTURE) === null;
}

/** Cheap enough to run before sanitising, which is the expensive part. */
const HAS_TABLE = /<table[\s>]/i;

/**
 * The clipboard's one data table, when that is all the clipboard holds.
 *
 * Sanitised first, so the `<meta>` and `<style>` a spreadsheet writes beside its
 * table do not count as content next to it, and because a template's contents
 * are inert: no script runs and no `src` loads while attacker supplied clipboard
 * HTML is read for its cell text. A fragment that also carries prose is a page
 * excerpt rather than a grid and belongs to the HTML paste path, which keeps
 * what surrounds the table instead of discarding it.
 */
function parseHtmlTable(html: string): string[][] | null {
  const outcome = sanitizeExternalHtml(html);
  if ('tooLarge' in outcome) return null;

  const tables = outcome.fragment.querySelectorAll('table');
  if (tables.length !== 1) return null;
  const table = tables[0];
  if (!isDataTable(table) || hasTextOutside(outcome.fragment, table)) return null;

  const out: string[][] = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll('td, th').forEach((td) => cells.push(cellText(td)));
    if (cells.length > 0) out.push(cells);
  });
  return out.length > 0 ? out : null;
}

/** Whether anything outside `table` carries text of its own. */
function hasTextOutside(fragment: DocumentFragment, table: Element): boolean {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!table.contains(node) && (node.nodeValue ?? '').trim() !== '') return true;
  }
  return false;
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
  // A clipboard whose HTML holds a table it is not entirely made of has no grid
  // at all: its tab separated text is the article's own tabs, not a rectangle.
  if (html && HAS_TABLE.test(html)) {
    const grid = parseHtmlTable(html);
    return grid ? { grid, fromHtml: true } : null;
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
