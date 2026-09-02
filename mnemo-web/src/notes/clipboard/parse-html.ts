/**
 * Untrusted external HTML to a ProseMirror slice.
 *
 * HTML from another app is sanitised first, then parsed with the editor's own
 * schema, so the result is only ever nodes the schema already knows, minus
 * anything the sanitiser stripped. `too-large` is reported separately so the
 * caller can degrade to plain text rather than let an unbounded paste through.
 *
 * Our own copy takes a different path entirely, restoring the exact slice from
 * the JSON payload, because the schema's rendered HTML does not survive a reparse
 * (a block's line is a `<div>` inside a `<p>`, and the parser closes the `<p>`).
 */

import { DOMParser as PMDOMParser, type Schema, type Slice } from 'prosemirror-model';

import { sanitizeExternalHtml } from './html-sanitize';
import { isDataTable } from './table-grid';

export type ExternalParse = { readonly slice: Slice } | 'too-large' | null;

/** Sanitise then parse untrusted HTML. Null when it holds nothing usable. */
export function parseExternalHtml(html: string, schema: Schema): ExternalParse {
  if (html.trim() === '') return null;

  const outcome = sanitizeExternalHtml(html);
  if ('tooLarge' in outcome) return 'too-large';

  restateTables(outcome.fragment);
  const slice = PMDOMParser.fromSchema(schema).parseSlice(outcome.fragment, {
    preserveWhitespace: false,
  });
  return slice.content.size === 0 ? null : { slice };
}

/** Inline tags a cell keeps as it stands; anything else in one is a wrapper. */
const INLINE_TAGS: ReadonlySet<string> = new Set([
  'A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'CODE', 'SPAN', 'FONT', 'SUB', 'SUP',
  'MARK', 'SMALL', 'ABBR', 'CITE', 'Q', 'TIME', 'VAR', 'KBD', 'SAMP',
]);

/**
 * Restates each data table in the fragment as the markup our schema parses.
 *
 * A table renders here as nested `div`s, so a foreign `<table>` matches no parse
 * rule at all: the parser walks straight through it and the cells arrive as one
 * run of loose text. Restating it keeps a table that came inside a page excerpt
 * a table, with the emphasis and links in its cells intact.
 *
 * A layout table is left as it stands. Its cells hold the page's own headings
 * and lists, which belong at the top level, and walking through it is how they
 * get there.
 */
function restateTables(fragment: DocumentFragment): void {
  for (const table of Array.from(fragment.querySelectorAll('table'))) {
    if (!isDataTable(table)) continue;
    const rows = Array.from(table.querySelectorAll('tr'))
      .map((tr) => Array.from(tr.querySelectorAll('td, th')))
      .filter((cells) => cells.length > 0);
    if (rows.length > 0) table.replaceWith(restatedTable(rows));
  }
}

function restatedTable(rows: readonly Element[][]): HTMLElement {
  const table = div('data-table');
  table.append(emptyLine());
  for (const cells of rows) {
    const row = div('data-table-row');
    row.append(emptyLine());
    for (const cell of cells) row.append(restatedCell(cell));
    table.append(row);
  }
  return table;
}

/** A cell is one run of prose, so its own wrappers flatten into a single line. */
function restatedCell(cell: Element): HTMLElement {
  const out = div('data-table-cell');
  const line = div('data-line');
  appendInline(line, cell);
  out.append(line);
  return out;
}

function appendInline(line: HTMLElement, source: Element): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      line.append(child);
      continue;
    }
    if (!(child instanceof Element)) continue;
    if (child.tagName === 'BR') {
      // The line keeps its whitespace, so a break is a real newline in it.
      line.append('\n');
    } else if (INLINE_TAGS.has(child.tagName)) {
      line.append(child);
    } else {
      if (line.childNodes.length > 0) line.append('\n');
      appendInline(line, child);
    }
  }
}

function div(attribute: string): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute(attribute, '');
  return element;
}

const emptyLine = (): HTMLElement => div('data-line');
