/**
 * Plain text -> `Block[]`: the reader for every plain-text paste.
 *
 * A blank line always ends a block and is never one itself, and each block between
 * blank lines reads by its own shape: list lines become a list, quote lines a quote
 * that keeps its line breaks, and anything else keeps every line break and every
 * character as typed. Only a paste that carries a document signal (a heading at a
 * block start, a code fence or a pipe table) is read as markdown, the way the host's
 * importer reads a file: wrapped prose joins with a space and inline markup applies.
 * Text with no blank line at all is read one block per line.
 *
 * It returns wire `Block`s with an empty `id`/`sid`, the signal the identity plugin
 * mints against once the run is dispatched, and stays a pure function of a string.
 *
 * List items nest by indentation: a list line indented past the item above it
 * becomes that item's child, and anything that is not a list item ends the nesting.
 * Sketch is accepted under both the host's ```sketch and the editor's ```mnemo-sketch
 * fence. The page card is read only in its `[[page:id]]` form, so a bare
 * `[[wikilink]]` stays literal text rather than becoming a broken card.
 */

import { endsWithBreakMarker } from '../model/hard-break';
import { oneParagraphSpans, parseInlineMarkdown } from '../model/markdown';
import { plainSpan } from '../model/spans';
import { TABLE_COL_W } from '../editor/table/model';
import { isTextSpan, type Block, type BlockPayload, type BlockType, type InlineSpan } from '../model/types';
import {
  EMPTY_PARAGRAPH,
  HEADING_SIGNAL,
  SETEXT_H1,
  THEMATIC_BREAK,
  appendSoftBreak,
  FenceIndex,
  closesFence,
  escapeBlockStart,
  opensBlock,
  opensPlainBlock,
  startsAsProse,
  separatesBlocksWithBlankLines,
} from './markdown-lines';
import { readPipeTable } from './markdown-table';

const PAGE_REF = /^\[\[page:([^\]]*)\]\]\s*$/;
/** A bullet introduced by `*` or `+`; the trailing space stops `*emphasis*` reading as a list. */
const STAR_BULLET = /^(?:\*|\+)\s+(.*)$/;
/** A numbered item; the editor renumbers on render, so the index is not stored. */
const NUMBERED = /^(\d{1,9})[.)]\s/;
const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
/** `> [!tone glyph]`, the editor's own head, and Obsidian's `> [!type]` with an optional fold sign. */
const CALLOUT_HEAD = /^>\s*\[!([A-Za-z]+)(?:\s+([^\]]+))?\][+-]?\s?(.*)$/;
/** Obsidian's warning-like callout types, read as the editor's one warning tone. */
const WARN_TONES = new Set(['warn', 'warning', 'caution', 'danger']);
/** The glyphs the editor gives a new callout, for a pasted one that names none. */
const NOTE_GLYPH = '💡';
const WARN_GLYPH = '⚠️';

/**
 * A ceiling on how many blocks one paste produces.
 *
 * A pathological paste, a couple of million characters of single-character lines,
 * would otherwise become a block per line and freeze the tab. Past the cap the
 * remaining text is folded into one literal block: bounded work, no characters dropped.
 */
export const MAX_BLOCKS = 10_000;

/**
 * The most physical lines one paragraph takes before the next starts a new one. Far past
 * any real paragraph, and it keeps each parse small on a paste of thousands of joined lines.
 */
const MAX_PARAGRAPH_LINES = 1_000;

/** `lines` reads one block per line, `markdown` reads a document, `plain` keeps the text as typed. */
type Reading = 'lines' | 'markdown' | 'plain';

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

const trimStart = (line: string): string => line.replace(/^\s+/, '');

/**
 * A heading at a block start, a closed code fence or a pipe table: the paste is a markdown
 * document. The line after front matter is a block start too.
 */
function hasDocumentSignal(lines: readonly string[], fences: FenceIndex, bodyStart: number): boolean {
  for (let j = 0; j < lines.length; j++) {
    const trimmed = trimStart(lines[j]);
    const atBlockStart = j === 0 || j === bodyStart || lines[j - 1].trim() === '';
    if (atBlockStart && HEADING_SIGNAL.test(trimmed)) return true;
    if (fences.openedAt(lines, j)) return true;
    if (readPipeTable(lines, j)) return true;
  }
  return false;
}

/** YAML front matter opening the paste: its body and the index after its closing line. */
function frontMatter(lines: readonly string[], start: number): { body: string; next: number } | null {
  if (lines[start]?.trim() !== '---') return null;
  for (let j = start + 1; j < lines.length; j++) {
    const bare = lines[j].trim();
    if (bare === '---' || bare === '...') {
      const body = lines.slice(start + 1, j);
      return body.some((l) => /^[A-Za-z0-9_-]+\s*:/.test(l)) ? { body: body.join('\n'), next: j + 1 } : null;
    }
    if (bare === '') return null;
  }
  return null;
}

/** What raw HTML alone, or an empty link, parses to. */
function showsNothing(spans: readonly InlineSpan[]): boolean {
  return spans.every((span) => isTextSpan(span) && span.text.trim() === '');
}

/** The text between the tags of a line of raw HTML, comments dropped. */
function htmlText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/** Parses pasted text into wire blocks, empty of identity. */
export function parseMarkdownToBlocks(markdown: string): Block[] {
  if (markdown.trim() === '') return [];

  const lines = markdown.split(/\r\n|\r|\n/);
  const fences = new FenceIndex(lines);
  // Front matter is the file's metadata, not a paragraph between two rules.
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  const matter = frontMatter(lines, start);
  const reading: Reading = !separatesBlocksWithBlankLines(lines, fences)
    ? 'lines'
    : hasDocumentSignal(lines, fences, matter?.next ?? 0)
      ? 'markdown'
      : 'plain';
  const out: Block[] = [];
  // The list items still open for nesting, outermost first, each with the indent
  // it was found at. A list line deeper than the innermost becomes its child.
  const open: { indent: number; item: Block }[] = [];
  // The last number of each numbered run, by indent, so a run counting up keeps going.
  const runs = new Map<number, number>();
  let count = 0;
  let i = 0;

  const inline = (text: string): InlineSpan[] => (reading === 'plain' ? [plainSpan(text)] : parseInlineMarkdown(text));

  const place = (block: Block, container: Block[]): void => {
    block.order = container.length;
    container.push(block);
    count += 1;
  };
  const emit = (type: BlockType, spans: readonly InlineSpan[], payload: BlockPayload): void => {
    open.length = 0;
    runs.clear();
    place(makeBlock(type, spans, payload), out);
  };
  const emitItem = (
    type: BlockType,
    spans: readonly InlineSpan[],
    payload: BlockPayload,
    indent: number,
    number?: number,
  ): void => {
    while (open.length > 0 && open[open.length - 1].indent >= indent) open.pop();
    for (const depth of [...runs.keys()]) if (depth > indent) runs.delete(depth);
    if (number === undefined) runs.delete(indent);
    else runs.set(indent, number);
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

  /** Outside a markdown document only a one, or the next number of a run, opens a list. */
  const numberOpens = (n: number, indent: number): boolean =>
    reading === 'markdown' || n <= 1 || runs.get(indent) === n - 1;

  // Markdown carries no widths, so the table gets the editor's default ones.
  const emitTable = (rows: readonly string[][]): void => {
    open.length = 0;
    runs.clear();
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
        const cell = makeBlock('TableCell', parseInlineMarkdown(cells[column] ?? ''), { kind: 'tableCell', fill: '' });
        place(cell, row.children);
      }
      place(row, table.children);
    }
    place(table, out);
  };

  /**
   * A block's text with the lines it continues onto folded in: while the text ends in
   * a hard break, the next physical line belongs to the same block. Returns the index
   * of the first line not taken. In plain text a backslash is only a backslash.
   */
  const withContinuation = (text: string, index: number): { text: string; next: number } => {
    let next = index + 1;
    // Only the last line is checked and the parts joined once, so a long run stays linear.
    let tail = text;
    const parts = [text];
    while (
      reading !== 'plain' &&
      next < lines.length &&
      next - index < MAX_PARAGRAPH_LINES &&
      endsWithBreakMarker(tail)
    ) {
      tail = escapeBlockStart(lines[next]);
      parts.push('\n', tail);
      next += 1;
    }
    return { text: parts.length === 1 ? text : parts.join(''), next };
  };

  /** True when the line after `last` continues the paragraph that `last` is in. */
  const takesNextLine = (last: number, numberedIndent: number | undefined): boolean =>
    last + 1 < lines.length &&
    lines[last].trim() !== '' &&
    readPipeTable(lines, last + 1) === null &&
    !opensBlock(
      lines,
      last + 1,
      fences,
      numberedIndent !== undefined && indentWidth(lines[last + 1]) <= numberedIndent,
    );

  /**
   * A markdown paragraph's text, its wrapped lines and lazy continuations joined the
   * CommonMark way. When the first line is not prose, or the joined text would stop
   * being one paragraph, every line stays its own block instead. A joined paragraph
   * comes with its spans, from the one parse that checked it.
   */
  const paragraph = (
    text: string,
    index: number,
    numberedIndent?: number,
  ): { text: string; next: number; spans?: InlineSpan[] } => {
    const single = withContinuation(text, index);
    if (reading !== 'markdown' || !takesNextLine(single.next - 1, numberedIndent)) return single;
    if (!startsAsProse(single.text)) return single;

    const pieces = [single.text];
    let last = single.next - 1;
    while (last + 1 - index < MAX_PARAGRAPH_LINES && takesNextLine(last, numberedIndent)) {
      last += 1;
      const [kept, added] = appendSoftBreak(pieces[pieces.length - 1], lines[last]);
      pieces[pieces.length - 1] = kept;
      const folded = withContinuation(added, last);
      pieces.push(folded.text);
      last = folded.next - 1;
    }
    const joined = pieces.join('');
    const spans = oneParagraphSpans(joined);
    return spans ? { text: joined, next: last + 1, spans } : single;
  };

  /** Plain lines from `index` up to a blank line or a block of their own, kept as typed. */
  const plainRun = (index: number, keeps: (line: string) => boolean): { text: string; next: number } => {
    let next = index + 1;
    while (
      next < lines.length &&
      keeps(lines[next]) &&
      !opensPlainBlock(lines, next, fences, (n) => numberOpens(n, indentWidth(lines[next])))
    ) {
      next += 1;
    }
    return { text: lines.slice(index, next).join('\n'), next };
  };

  /**
   * The indent of the numbered item a list item at `indent` sits in, its own when it is one.
   * A number at or left of it is that list's next item, so it never folds into the text.
   */
  const numberedDepth = (indent: number, numbered: boolean): number | undefined => {
    if (numbered) return indent;
    for (let k = open.length - 1; k >= 0; k--) {
      if (open[k].indent < indent && open[k].item.type === 'NumberedList') return open[k].indent;
    }
    return undefined;
  };

  /** A list item's text and the lines it runs onto, read the way the paste reads. */
  const itemBody = (
    text: string,
    index: number,
    indent: number,
    numbered: boolean,
  ): { text: string; next: number; spans?: InlineSpan[] } => {
    if (reading === 'markdown') return paragraph(trimStart(text), index, numberedDepth(indent, numbered));
    if (reading === 'lines') return withContinuation(text.trim(), index);
    // Plain: a line indented under the marker carries the item on, as typed.
    const run = plainRun(index, (line) => indentWidth(line) > indent);
    const rest = run.text.split('\n').slice(1).map(trimStart);
    return { text: [text.trim(), ...rest].join('\n'), next: run.next };
  };

  /** The lines of a quote run from `i`, a callout head ending it, each kept as its own line. */
  const quoteRun = (first: string): string => {
    const quoted = [first];
    i++;
    while (i < lines.length) {
      const next = trimStart(lines[i]);
      if (CALLOUT_HEAD.test(next) || !next.startsWith('>')) break;
      quoted.push(unquote(next));
      i++;
    }
    // Escaped where a parser would start a block, so every line stays a line of the quote.
    return reading === 'plain' ? quoted.join('\n') : quoted.map((line) => escapeBlockStart(line)).join('\n');
  };

  if (matter) {
    emit('Code', [plainSpan(matter.body)], { kind: 'code', language: 'yaml', source: matter.body });
    i = matter.next;
  }

  while (i < lines.length) {
    // Past the cap the rest of the paste lands as one verbatim block rather than a
    // block per line, so a pathologically long paste cannot freeze the tab.
    if (count >= MAX_BLOCKS) {
      emit('Text', [plainSpan(lines.slice(i).join('\n'))], { kind: 'empty' });
      break;
    }

    const line = lines[i];
    const indent = indentWidth(line);
    const trimmed = trimStart(line);
    const bare = line.trim();

    if (bare === '') {
      i++;
      continue;
    }

    if (THEMATIC_BREAK.test(bare)) {
      emit('Divider', [plainSpan('')], { kind: 'empty' });
      i++;
      continue;
    }

    const page = PAGE_REF.exec(trimmed);
    if (page) {
      emit('Page', [plainSpan('')], { kind: 'page', referenceNoteId: page[1].trim() });
      i++;
      continue;
    }

    // An opener with no closer below it is a line of text; read as a fence it would
    // take every line after it into one equation.
    if (
      (trimmed === '$$' && fences.mathCloses(i)) ||
      (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 2)
    ) {
      if (trimmed === '$$') {
        const body: string[] = [];
        i++;
        while (i < lines.length) {
          if (trimStart(lines[i]) === '$$') {
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

    // An opener with no closer below it is text, or it would take the rest of the paste.
    const fence = fences.openedAt(lines, i);
    if (fence) {
      const language = fence.info.split(/\s+/)[0] ?? '';
      const isSketch = fence.info.toLowerCase() === 'sketch' || fence.info.toLowerCase() === 'mnemo-sketch';
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        if (closesFence(lines[i], fence)) {
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

    // Plain text has no headings: one at a block start would have made it a document.
    const heading = reading === 'plain' ? null : headingOf(trimmed);
    if (heading) {
      const body = withContinuation(heading.content, i);
      emit(heading.type, parseInlineMarkdown(body.text), { kind: 'empty' });
      i = body.next;
      continue;
    }

    const checklist = /^-\s*\[\s*([xX]?)\s*\]\s*/.exec(trimmed);
    if (checklist) {
      const body = itemBody(trimmed.slice(checklist[0].length), i, indent, false);
      const checked = checklist[1] !== '';
      emitItem('Checklist', body.spans ?? inline(body.text), { kind: 'checklist', checked }, indent);
      i = body.next;
      continue;
    }

    const bullet = trimmed.startsWith('- ') ? trimmed.slice(2) : STAR_BULLET.exec(trimmed)?.[1];
    if (bullet !== undefined) {
      const body = itemBody(bullet, i, indent, false);
      emitItem('BulletList', body.spans ?? inline(body.text), { kind: 'empty' }, indent);
      i = body.next;
      continue;
    }

    // Probed ahead of the quote: a callout is a quote whose first token is its head.
    const callout = CALLOUT_HEAD.exec(trimmed);
    if (callout) {
      const text = quoteRun(trimStart(callout[3]));
      const named = callout[1].toLowerCase();
      const tone = WARN_TONES.has(named) ? 'warn' : named;
      emit('Callout', inline(text), {
        kind: 'callout',
        emoji: callout[2]?.trim() || (tone === 'warn' ? WARN_GLYPH : NOTE_GLYPH),
        tone,
      });
      continue;
    }

    if (trimmed.startsWith('>')) {
      emit('Quote', inline(quoteRun(unquote(trimmed))), { kind: 'empty' });
      continue;
    }

    const numbered = NUMBERED.exec(trimmed);
    if (numbered && numberOpens(Number(numbered[1]), indent)) {
      const body = itemBody(trimmed.slice(numbered[0].length), i, indent, true);
      emitItem('NumberedList', body.spans ?? inline(body.text), { kind: 'empty' }, indent, Number(numbered[1]));
      i = body.next;
      continue;
    }

    const image = IMAGE.exec(trimmed);
    if (image) {
      const path = unescapeImageTarget(image[2].trim());
      const alt = unescapeImageAlt(image[1]);
      // Markdown has no way to spell a crop, so the reference arrives whole.
      emit('Image', [plainSpan(alt)], { kind: 'image', path, alt, width: 0, align: 'left', crop: null });
      i++;
      continue;
    }

    const table = readPipeTable(lines, i);
    if (table) {
      emitTable(table.rows);
      i = table.next;
      continue;
    }

    if (bare === EMPTY_PARAGRAPH || bare === `\\${EMPTY_PARAGRAPH}`) {
      // The escaped form is a paragraph that literally reads `&nbsp;`, in every reading.
      emit('Text', [plainSpan(bare === EMPTY_PARAGRAPH ? '' : EMPTY_PARAGRAPH)], { kind: 'empty' });
      i++;
      continue;
    }

    if (reading === 'plain') {
      const body = plainRun(i, (next) => next.trim() !== '');
      emit('Text', [plainSpan(body.text)], { kind: 'empty' });
      i = body.next;
      continue;
    }

    // The raw line, so leading indentation is not silently trimmed. A pipe row stays
    // its own line: joined, a broken table would fold into one run-on paragraph.
    const body: { text: string; next: number; spans?: InlineSpan[] } = trimmed.startsWith('|')
      ? withContinuation(line, i)
      : paragraph(line, i);
    if (reading === 'markdown' && body.next < lines.length && SETEXT_H1.test(lines[body.next].trim())) {
      emit('Heading1', parseInlineMarkdown(body.text.trim()), { kind: 'empty' });
      i = body.next + 1;
      continue;
    }
    i = body.next;
    // A number that did not open a list is the text's own, not a marker for the parser.
    const spans = numbered
      ? parseInlineMarkdown(escapeBlockStart(body.text))
      : (body.spans ?? parseInlineMarkdown(body.text));
    if (!showsNothing(spans)) {
      emit('Text', spans, { kind: 'empty' });
      continue;
    }
    // Raw HTML parses to nothing; the text between its tags is kept, a bare tag dropped.
    const kept = htmlText(body.text);
    if (kept !== '') emit('Text', [plainSpan(kept)], { kind: 'empty' });
  }

  return out;
}

/** A quote line without its marker and the one space after it. */
function unquote(trimmed: string): string {
  return trimmed.slice(1).replace(/^ /, '');
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
  // The order is assigned where the block lands, per container.
  return { id: '', sid: '', type, spans: [...spans], payload, meta: {}, order: 0, children: null };
}

/** `<target>` angle-bracket wrapping is stripped, matching the host reader. */
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
