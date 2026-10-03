/**
 * Line rules for the paste reader: where a block starts, where a paragraph ends, and
 * how its wrapped lines join. The host's markdown importer applies the same rules, so
 * a file and a paste of the same text agree.
 */

import { HARD_BREAK } from '../model/hard-break';

/** An empty paragraph as the writers spell it, since a blank line only separates blocks. */
export const EMPTY_PARAGRAPH = '&nbsp;';

export const HEADING_SIGNAL = /^#{1,6}\s+\S/;
const HEADING_START = /^#{1,6}(\s|$)/;
const NUMBERED_START = /^\d{1,9}[.)]\s/;
/** After prose only an item numbered one opens a list, so a wrapped line starting with a year stays in its sentence. */
const INTERRUPTING_NUMBERED = /^0{0,8}1[.)]\s/;
const CHECKLIST = /^-\s*\[\s*[xX]?\s*\]/;
const STAR_OR_PLUS_BULLET = /^[*+]\s+/;
export const THEMATIC_BREAK = /^([-*_])(\s*\1){2,}\s*$/;
export const SETEXT_H1 = /^=+$/;
const PAGE_REF = /^\[\[page:([^\]]*)\]\]\s*$/;
const IMAGE_REF = /^!\[([^\]]*)\]\(([^)]*)\)\s*$/;

/** The HTML block starts CommonMark lets interrupt a paragraph; an inline tag does not. */
const HTML_BLOCK_START =
  '<(?:(?:script|pre|style|textarea)\\b|!--|\\?|![A-Za-z]|!\\[CDATA\\[|/?(?:address|article|aside|blockquote|body|center|details|dialog|dir|div|dl|dd|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|html|iframe|legend|li|main|menu|nav|ol|p|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)(?:\\s|/?>|$))';
const HTML_BLOCK = new RegExp('^' + HTML_BLOCK_START, 'i');

/** A trimmed line a CommonMark parser would start a block with, were it handed one at a line start. */
const PARSER_BLOCK_START = new RegExp(
  '^(#{1,6}(\\s|$)|=+\\s*$|-+\\s*$|([-*_])(\\s*\\3){2,}\\s*$|[-+*](\\s|$)|[0-9]{1,9}[.)](\\s|$)|>|```|~~~|\\$\\$|[:~]\\s|\\[\\^|\\*\\[|:::|\\^\\^|' +
    HTML_BLOCK_START +
    ')',
  'i',
);

const trimStart = (line: string): string => line.replace(/^\s+/, '');

/** A code fence opener: its run of backticks or tildes and the info string after it. */
export interface Fence {
  readonly marker: string;
  readonly info: string;
}

/** The fence a trimmed line opens, or null. A backtick fence's info string holds no backtick. */
export function fenceOf(trimmed: string): Fence | null {
  const match = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
  if (!match) return null;
  if (match[1][0] === '`' && match[2].includes('`')) return null;
  return { marker: match[1], info: match[2].trim() };
}

/**
 * True when a trimmed-start line ends a pipe table: a heading, list item, quote or code
 * fence, even one that holds a pipe. A table ends there the way a paragraph does.
 */
export function endsPipeTable(line: string): boolean {
  const trimmed = trimStart(line);
  return (
    fenceOf(trimmed) !== null ||
    trimmed.startsWith('>') ||
    HEADING_START.test(trimmed) ||
    NUMBERED_START.test(trimmed) ||
    trimmed.startsWith('- ') ||
    CHECKLIST.test(trimmed) ||
    STAR_OR_PLUS_BULLET.test(trimmed)
  );
}

/**
 * Which fences close below each line, found in one backward pass so a paste with
 * thousands of openers stays linear. An opener with no closer below it is text.
 */
export class FenceIndex {
  private readonly backticks: Int32Array;
  private readonly tildes: Int32Array;
  private readonly math: Uint8Array;

  constructor(lines: readonly string[]) {
    this.backticks = new Int32Array(lines.length + 1);
    this.tildes = new Int32Array(lines.length + 1);
    this.math = new Uint8Array(lines.length + 1);
    let backticks = 0;
    let tildes = 0;
    let math = 0;
    for (let j = lines.length - 1; j >= 0; j--) {
      this.backticks[j] = backticks;
      this.tildes[j] = tildes;
      this.math[j] = math;
      const bare = lines[j].trim();
      if (/^`{3,}$/.test(bare)) backticks = Math.max(backticks, bare.length);
      else if (/^~{3,}$/.test(bare)) tildes = Math.max(tildes, bare.length);
      else if (bare === '$$') math = 1;
    }
  }

  /** Whether a line below `index` closes the fence opened there. */
  closes(index: number, fence: Fence): boolean {
    const longest = fence.marker[0] === '`' ? this.backticks[index] : this.tildes[index];
    return longest >= fence.marker.length;
  }

  /** Whether a `$$` line follows `index`, so a `$$` there opens an equation. */
  mathCloses(index: number): boolean {
    return this.math[index] === 1;
  }

  /** The fence the line at `index` opens, when a line below closes it. */
  openedAt(lines: readonly string[], index: number): Fence | null {
    const fence = fenceOf(trimStart(lines[index]));
    return fence && this.closes(index, fence) ? fence : null;
  }
}

/** True when the line closes the fence: the same character, at least as many, nothing after. */
export function closesFence(line: string, fence: Fence): boolean {
  const bare = line.trim();
  return bare.length >= fence.marker.length && [...bare].every((ch) => ch === fence.marker[0]);
}

/** Whether a blank line sits between two lines of content, outside a fence. */
export function separatesBlocksWithBlankLines(lines: readonly string[], index: FenceIndex): boolean {
  let seenContent = false;
  let pendingBlank = false;
  for (let j = 0; j < lines.length; j++) {
    const bare = lines[j].trim();
    if (bare === '') {
      pendingBlank = seenContent;
      continue;
    }
    if (pendingBlank) return true;
    seenContent = true;
    const fence = index.openedAt(lines, j);
    if (fence) {
      while (j + 1 < lines.length && !closesFence(lines[j + 1], fence)) j++;
      j++;
    } else if (bare === '$$' && index.mathCloses(j)) {
      while (j + 1 < lines.length && lines[j + 1].trim() !== '$$') j++;
      j++;
    }
  }
  return false;
}

/**
 * True when the line at `at` opens a block of its own rather than continuing a paragraph.
 * `anyNumberOpens` is set where the line sits at the depth of a numbered list, so any
 * number starts that list's next item.
 */
export function opensBlock(lines: readonly string[], at: number, index: FenceIndex, anyNumberOpens: boolean): boolean {
  const line = lines[at];
  const trimmed = trimStart(line);
  const bare = line.trim();
  if (bare === '') return true;
  if (index.openedAt(lines, at) || trimmed.startsWith('>') || trimmed.startsWith('|')) return true;
  if (trimmed.startsWith(':::') || trimmed.startsWith('^^^')) return true;
  if ((bare === '$$' && index.mathCloses(at)) || (bare.startsWith('$$') && bare.endsWith('$$') && bare.length > 2)) {
    return true;
  }
  if (SETEXT_H1.test(bare) || /^-+$/.test(bare) || THEMATIC_BREAK.test(bare)) return true;
  if (NUMBERED_START.test(trimmed)) return anyNumberOpens || INTERRUPTING_NUMBERED.test(trimmed);
  return (
    trimmed.startsWith('- ') ||
    HEADING_START.test(trimmed) ||
    CHECKLIST.test(trimmed) ||
    STAR_OR_PLUS_BULLET.test(trimmed) ||
    HTML_BLOCK.test(trimmed) ||
    PAGE_REF.test(trimmed) ||
    IMAGE_REF.test(trimmed)
  );
}

/**
 * True when the line at `at` ends a plain paragraph: a list item that may open there, a
 * quote, or a closed fence. Anything else, markup included, stays a line of the paragraph.
 */
export function opensPlainBlock(
  lines: readonly string[],
  at: number,
  index: FenceIndex,
  numberOpens: (n: number) => boolean,
): boolean {
  const trimmed = trimStart(lines[at]);
  if (trimmed === '' || trimmed.startsWith('>') || index.openedAt(lines, at)) return true;
  if (trimmed.startsWith('- ') || CHECKLIST.test(trimmed) || STAR_OR_PLUS_BULLET.test(trimmed)) return true;
  const numbered = /^(\d{1,9})[.)]\s/.exec(trimmed);
  return numbered !== null && numberOpens(Number(numbered[1]));
}

const LINK_DEFINITION = /^\[[^\]]*\]:/;
const INDENTED_CODE = /^( {0,3}\t| {4})/;

/**
 * Whether a paragraph's first line is prose, as a parser would read it, rather than the
 * start of another block. A cheap check before joining; the joined text is parsed anyway.
 */
export function startsAsProse(text: string): boolean {
  const end = text.indexOf('\n');
  const first = end < 0 ? text : text.slice(0, end);
  if (INDENTED_CODE.test(first)) return false;
  const trimmed = trimStart(first);
  return trimmed !== '' && !PARSER_BLOCK_START.test(trimmed) && !LINK_DEFINITION.test(trimmed);
}

/**
 * A line handed to a parser that would otherwise start a new block with it, and drop
 * or reinterpret the text, escaped at its first character.
 */
export function escapeBlockStart(line: string): string {
  const trimmed = trimStart(line);
  if (!PARSER_BLOCK_START.test(trimmed)) return line;
  const lead = line.slice(0, line.length - trimmed.length);
  const digits = /^\d*/.exec(trimmed)?.[0].length ?? 0;
  return digits > 0 ? lead + trimmed.slice(0, digits) + '\\' + trimmed.slice(digits) : lead + '\\' + trimmed;
}

/**
 * A paragraph's next physical line folded onto it. A plain line ending is a CommonMark
 * soft break, which reads as a space; two trailing spaces are the other hard break form.
 * Returns `text` without its trailing blanks and what follows it, so a caller joining
 * many lines never rescans what it already has.
 */
export function appendSoftBreak(text: string, next: string): [kept: string, added: string] {
  const hard = text.endsWith('  ');
  let end = text.length;
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end -= 1;
  const rest = trimStart(next);
  return [text.slice(0, end), hard ? HARD_BREAK + escapeBlockStart(rest) : ' ' + rest];
}
