/**
 * The token a caret-anchored menu reads its query from.
 *
 * A menu raised by a typed character, `/` for blocks or `\` for symbols, has
 * to know two things on every transaction: whether the caret still sits at
 * the end of the token that character started, and what has been typed after
 * it. Both are answered from the document, never from a search field, which
 * is what makes Backspace over the trigger dismiss the menu with no rule of
 * its own and what leaves the typed text there to be edited on Escape.
 *
 * A token begins at a word boundary: the start of the line, whitespace, an
 * opening bracket, or an inline atom. Never after a letter, a digit or
 * punctuation, so `C:\Users` and `and/or` stay ordinary text while `(\alpha`
 * opens the palette. Atoms count as boundaries because they contribute no text
 * of their own; the reader stands one placeholder character in for each so a
 * string offset and a document position agree.
 */

import type { EditorState } from 'prosemirror-state';
import { blockContext } from '../commands/caret-block';

/** U+FFFC, the object replacement character, standing in for an inline atom. */
const ATOM = '\ufffc';

const OPENING_BRACKETS = new Set(['(', '[', '{']);

export interface TokenReader {
  /** The character that starts the token, `/` or `\`. */
  readonly trigger: string;
  /**
   * Whether the query may run on across spaces. The slash menu allows it so
   * `/heading 3` reaches the row; a LaTeX name never holds one, so the palette
   * treats a space as the end of the token.
   */
  readonly spaces: boolean;
}

export interface TriggerToken {
  /** Position of the trigger character. */
  readonly from: number;
  /** The caret, which is where the token ends. */
  readonly to: number;
  /** What was typed after the trigger. */
  readonly query: string;
}

function isBoundary(char: string): boolean {
  return char === ATOM || OPENING_BRACKETS.has(char) || /\s/u.test(char);
}

/**
 * Index of the last `trigger` that sits at a word boundary, or -1. The last
 * rather than the first so `\alpha \beta` reads the token being typed, and a
 * search for the trigger rather than for the nearest boundary so a query
 * allowed to hold spaces, `/heading 3`, still finds its slash.
 */
function tokenStart(before: string, trigger: string): number {
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i] === trigger && (i === 0 || isBoundary(before[i - 1]!))) return i;
  }
  return -1;
}

/**
 * The token at the caret that begins with the reader's trigger, or null when
 * there is none where the caret is.
 *
 * With `at`, the token is read from that armed position rather than found by
 * scanning back, which is what keeps a slash query alive across the spaces it
 * is allowed to contain. Refused on a range selection, which is the user
 * selecting text rather than typing a command, on a source line and inside an
 * inline code mark, where both trigger characters are ordinary content.
 */
export function readToken(state: EditorState, reader: TokenReader, at?: number): TriggerToken | null {
  if (!state.selection.empty) return null;
  const ctx = blockContext(state);
  if (!ctx || ctx.line.type.spec.code === true) return null;

  const { $from } = state.selection;
  const marks = state.storedMarks ?? $from.marks();
  if (marks.some((mark) => mark.type.name === 'codeMark')) return null;
  const lineStart = $from.start();
  const before = ctx.line.textBetween(0, ctx.offset, undefined, ATOM);

  const start = at === undefined ? tokenStart(before, reader.trigger) : at - lineStart;
  if (start < 0 || start >= before.length) return null;
  if (before[start] !== reader.trigger) return null;
  if (start > 0 && !isBoundary(before[start - 1]!)) return null;

  const query = before.slice(start + 1);
  if (query.includes(ATOM)) return null;
  if (!reader.spaces && /\s/u.test(query)) return null;

  return { from: lineStart + start, to: $from.pos, query };
}
