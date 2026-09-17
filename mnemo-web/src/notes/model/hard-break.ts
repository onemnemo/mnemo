/**
 * The markdown form of a newline inside one block, shared by the writer, the paste
 * reader and the inline parser so the three cannot drift.
 *
 * A soft break is a literal newline in span text. Written bare, a reader that splits
 * on physical lines cannot tell it from the next block, so it goes out as the
 * CommonMark hard break: a backslash before the line ending. A literal backslash is
 * escaped to two, which is why a line ends in a break exactly when its trailing run
 * of backslashes is odd. The desktop's `MarkdownHardBreak` is the same rule.
 */

export const HARD_BREAK = '\\\n';

/** True when a physical line (no line ending) ends in a hard break marker. */
export function endsWithBreakMarker(line: string): boolean {
  let run = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) run += 1;
  return run % 2 === 1;
}

/** Inline markdown folded onto one line, for a table cell or an image caption. */
export function collapseHardBreaks(markdown: string): string {
  return markdown.replaceAll(HARD_BREAK, ' ');
}

/**
 * Splits off the hard breaks a text ends with, which a CommonMark parser would read as
 * literal backslashes because nothing follows them. The reader puts them back as the
 * newlines they stand for once the rest has been parsed.
 */
export function splitTrailingBreaks(text: string): { text: string; breaks: number } {
  let breaks = 0;
  while (text.endsWith('\n') && endsWithBreakMarker(text.slice(0, -1))) {
    text = text.slice(0, -HARD_BREAK.length);
    breaks += 1;
  }
  return { text, breaks };
}
