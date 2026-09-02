/**
 * Plain text -> `Block[]`: the paste dialect the desktop falls back to.
 *
 * The desktop has no HTML paste path at all, so its whole cross-app import is
 * this one function, `BlockMarkdownSerializer.Deserialize`, and matching it byte
 * for byte is what makes a note copied on the desktop paste back the same here.
 * The reader is deliberately line-oriented and forgiving, the same shape as the
 * original: one block per line, a handful of multi-line fences, and a plain-text
 * fallback that still runs the inline markdown parser so `**bold**` in pasted
 * text becomes bold rather than literal asterisks.
 *
 * It returns wire `Block`s, not ProseMirror nodes, for two reasons: it mirrors
 * the desktop, whose `Deserialize` returns view models the placement code then
 * drops in; and it stays a pure function of a string, testable without a schema.
 * Every block comes out with an empty `id`/`sid`, which is the signal the
 * identity plugin mints against once the run is dispatched, the same contract
 * the exact-slice paste path relies on.
 *
 * List items nest by indentation, the one place a line's leading whitespace
 * means something: a list line indented past the item above it becomes that
 * item's child, at whatever width the writer chose, and anything that is not a
 * list item ends the nesting. The host's reader applies the same rule, so a
 * nested list survives the trip through markdown in either direction.
 *
 * Two dialects are read where they diverge. The port emits a numbered item as a
 * literal `1.` and renumbers on render, so the stored index is not read back.
 * Sketch is accepted under both the desktop's ```sketch and the port's own
 * ```mnemo-sketch fence, since a note can arrive from either side; the page card
 * is read only in the desktop's `[[page:id]]` form, which the port now also
 * emits, so a bare `[[wikilink]]` stays literal text rather than becoming a
 * broken card.
 */

import { parseInlineMarkdown } from '../model/markdown';
import { plainSpan } from '../model/spans';
import { TABLE_COL_W } from '../editor/table/model';
import type { Block, BlockPayload, BlockType, InlineSpan } from '../model/types';

/** A page reference in either the desktop or the port's own emitted form. */
const PAGE_REF = /^\[\[page:([^\]]*)\]\]\s*$/;
/** A bullet introduced by `*` or `+`; the trailing space stops `*emphasis*` reading as a list. */
const STAR_BULLET = /^(?:\*|\+)\s+(.*)$/;
/** A numbered item; the index is captured but the port renumbers on render, so it is not stored. */
const NUMBERED = /^(\d+)\.\s/;
/** `![alt](target)` on a line of its own. */
const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

/**
 * The delimiter row under a pipe table's header: dashes per column, with the
 * optional colons that mark alignment, which this reader accepts and drops.
 */
const TABLE_DELIMITER = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** The cells of one pipe table row, a backslash keeping a pipe literal. */
function splitPipeRow(row: string): string[] {
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
 * A ceiling on how many blocks one paste produces.
 *
 * A pathological paste, a couple of million characters of single-character lines,
 * would otherwise become a block per line, roughly a million of them, and freeze
 * the tab mapping and placing them. Past the cap the remaining text is folded into
 * one literal block instead: bounded work, and no characters dropped. Well above
 * any real document, the perf gate sizes a legitimate paste in the hundreds.
 */
export const MAX_BLOCKS = 10_000;

/** Leading indentation in columns, a tab counting as four, the CommonMark reading. */
function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

/** Parses a Mnemo-markdown string into wire blocks, empty of identity. */
export function parseMarkdownToBlocks(markdown: string): Block[] {
  if (markdown.trim() === '') return [];

  const lines = markdown.split(/\r\n|\r|\n/);
  const out: Block[] = [];
  // The list items still open for nesting, outermost first, each with the indent
  // it was found at. A list line deeper than the innermost becomes its child.
  const open: { indent: number; item: Block }[] = [];
  let count = 0;
  let i = 0;

  const place = (block: Block, container: Block[]): void => {
    block.order = container.length;
    container.push(block);
    count += 1;
  };
  const emit = (type: BlockType, spans: readonly InlineSpan[], payload: BlockPayload): void => {
    open.length = 0;
    place(makeBlock(type, spans, payload), out);
  };
  const emitItem = (
    type: BlockType,
    spans: readonly InlineSpan[],
    payload: BlockPayload,
    indent: number,
  ): void => {
    while (open.length > 0 && open[open.length - 1].indent >= indent) open.pop();
    const item = makeBlock(type, spans, payload);
    const parent = open.length > 0 ? open[open.length - 1].item : null;
    if (parent) {
      parent.children ??= [];
      place(item, parent.children);
    } else {
      place(item, out);
    }
    open.push({ indent, item });
  };

  // A pipe table, the shape `tableMarkdown` writes: the first row is the header,
  // every row is padded to the widest one, and the widths are the editor's
  // default since markdown carries none.
  const emitTable = (rows: readonly string[][]): void => {
    open.length = 0;
    const width = rows.reduce((widest, cells) => Math.max(widest, cells.length), 0);
    const table = makeBlock('Table', [plainSpan('')], {
      kind: 'table',
      columnWidths: Array.from({ length: width }, () => TABLE_COL_W),
      headerRows: rows.map((_cells, index) => index === 0),
      headerColumns: Array.from({ length: width }, () => false),
      fullWidth: false,
    });
    table.children = [];
    for (const cells of rows) {
      const row = makeBlock('TableRow', [plainSpan('')], { kind: 'empty' });
      row.children = [];
      for (let column = 0; column < width; column++) {
        const text = cells[column] ?? '';
        const cell = makeBlock('TableCell', parseInlineMarkdown(text), { kind: 'tableCell', fill: '' });
        place(cell, row.children);
      }
      place(row, table.children);
    }
    place(table, out);
  };

  while (i < lines.length) {
    // Past the cap the rest of the paste lands as one verbatim block rather than a
    // block per line, so a pathologically long paste cannot freeze the tab.
    if (count >= MAX_BLOCKS) {
      emit('Text', [plainSpan(lines.slice(i).join('\n'))], { kind: 'empty' });
      break;
    }

    const line = lines[i];
    const indent = indentWidth(line);
    const trimmed = line.replace(/^\s+/, '');

    // Divider.
    if (trimmed === '---' || line.trim() === '---') {
      emit('Divider', [plainSpan('')], { kind: 'empty' });
      i++;
      continue;
    }

    // Page reference.
    const page = PAGE_REF.exec(trimmed);
    if (page) {
      emit('Page', [plainSpan('')], { kind: 'page', referenceNoteId: page[1].trim() });
      i++;
      continue;
    }

    // Equation: a `$$` fence, either the whole line or a block opened on its own.
    if (trimmed === '$$' || (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 2)) {
      if (trimmed === '$$') {
        const body: string[] = [];
        i++;
        while (i < lines.length) {
          if (lines[i].replace(/^\s+/, '') === '$$') {
            i++;
            break;
          }
          body.push(lines[i]);
          i++;
        }
        emit('Equation', [plainSpan('')], { kind: 'equation', latex: body.join('\n').trim() });
      } else {
        emit('Equation', [plainSpan('')], { kind: 'equation', latex: trimmed.slice(2, -2).trim() });
        i++;
      }
      continue;
    }

    // Code / sketch fence.
    if (trimmed.startsWith('```')) {
      const fence = trimmed.length > 3 ? trimmed.slice(3).trim() : '';
      const isSketch = fence.toLowerCase() === 'sketch' || fence.toLowerCase() === 'mnemo-sketch';
      const language = fence === '' ? 'csharp' : fence;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        if (lines[i].replace(/^\s+/, '').startsWith('```')) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      const source = body.join('\n');
      if (isSketch) {
        emit('Sketch', [plainSpan(source)], { kind: 'sketch', width: 0, align: 'left' });
      } else {
        emit('Code', [plainSpan(source)], { kind: 'code', language, source });
      }
      continue;
    }

    // Headings, longest fence first so `##` never matches as `#`.
    const heading = headingOf(trimmed);
    if (heading) {
      emit(heading.type, parseInlineMarkdown(heading.content), { kind: 'empty' });
      i++;
      continue;
    }

    // Checklist, checked then unchecked.
    if (/^-\s*\[\s*[xX]\s*\]/.test(trimmed)) {
      const content = trimmed.replace(/^-\s*\[\s*[xX]\s*\]\s*/, '').trim();
      emitItem('Checklist', parseInlineMarkdown(content), { kind: 'checklist', checked: true }, indent);
      i++;
      continue;
    }
    if (/^-\s*\[\s*\]/.test(trimmed)) {
      const content = trimmed.replace(/^-\s*\[\s*\]\s*/, '').trim();
      emitItem('Checklist', parseInlineMarkdown(content), { kind: 'checklist', checked: false }, indent);
      i++;
      continue;
    }

    // Bullet: `- `, then the CommonMark `*`/`+` markers.
    if (trimmed.startsWith('- ')) {
      emitItem('BulletList', parseInlineMarkdown(trimmed.slice(2).trim()), { kind: 'empty' }, indent);
      i++;
      continue;
    }
    const star = STAR_BULLET.exec(trimmed);
    if (star) {
      emitItem('BulletList', parseInlineMarkdown(star[1].trim()), { kind: 'empty' }, indent);
      i++;
      continue;
    }

    // Quote: consecutive `> ` (or bare `>`) lines fold into one multi-line block.
    if (trimmed.startsWith('> ') || trimmed === '>') {
      const quoted: string[] = [trimmed === '>' ? '' : trimmed.slice(2).trim()];
      i++;
      while (i < lines.length) {
        const next = lines[i].replace(/^\s+/, '');
        if (next.startsWith('> ')) {
          quoted.push(next.slice(2).trim());
          i++;
        } else if (next === '>') {
          quoted.push('');
          i++;
        } else {
          break;
        }
      }
      emit('Quote', parseInlineMarkdown(quoted.join('\n')), { kind: 'empty' });
      continue;
    }

    // Numbered item. The index is read to confirm the match but not stored.
    if (NUMBERED.test(trimmed)) {
      const content = trimmed.replace(/^\d+\.\s*/, '').trim();
      emitItem('NumberedList', parseInlineMarkdown(content), { kind: 'empty' }, indent);
      i++;
      continue;
    }

    // A lone image reference.
    const image = IMAGE.exec(trimmed);
    if (image) {
      const path = unescapeImageTarget(image[2].trim());
      const alt = unescapeImageAlt(image[1]);
      // Markdown has no way to spell a crop, so the reference arrives whole.
      emit('Image', [plainSpan(alt)], { kind: 'image', path, alt, width: 0, align: 'left', crop: null });
      i++;
      continue;
    }

    // Pipe table: a row followed by a delimiter row opens one, and it runs while
    // the lines keep starting with a pipe. A lone line starting with a pipe is
    // text, since nothing says it meant to be a grid.
    if (trimmed.startsWith('|') && i + 1 < lines.length && TABLE_DELIMITER.test(lines[i + 1])) {
      const rows: string[][] = [splitPipeRow(trimmed)];
      i += 2;
      while (i < lines.length && lines[i].replace(/^\s+/, '').startsWith('|')) {
        rows.push(splitPipeRow(lines[i]));
        i++;
      }
      emitTable(rows);
      continue;
    }

    // Plain text: the raw line, so leading indentation is not silently trimmed,
    // still through the inline parser so pasted markdown styling survives.

    emit('Text', parseInlineMarkdown(line), { kind: 'empty' });
    i++;
  }

  return out;
}

const HEADINGS: readonly { readonly fence: string; readonly type: BlockType }[] = [
  { fence: '#### ', type: 'Heading4' },
  { fence: '### ', type: 'Heading3' },
  { fence: '## ', type: 'Heading2' },
  { fence: '# ', type: 'Heading1' },
];

function headingOf(trimmed: string): { type: BlockType; content: string } | null {
  for (const { fence, type } of HEADINGS) {
    if (trimmed.startsWith(fence)) return { type, content: trimmed.slice(fence.length).trim() };
  }
  return null;
}

function makeBlock(type: BlockType, spans: readonly InlineSpan[], payload: BlockPayload): Block {
  // Empty id/sid is the contract: the identity plugin mints fresh, note-scoped
  // ids on the paste transaction, so nothing collides with an existing block.
  // The order is assigned where the block lands, per container.
  return { id: '', sid: '', type, spans: [...spans], payload, meta: {}, order: 0, children: null };
}

/** `<target>` angle-bracket wrapping is stripped, matching the desktop reader. */
function unescapeImageTarget(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Reverses the alt escaping the image serializer applies, `\]` and `\\` in order. */
function unescapeImageAlt(alt: string): string {
  return alt.replaceAll('\\]', ']').replaceAll('\\\\', '\\');
}
