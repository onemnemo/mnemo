/**
 * Tab and Shift+Tab inside a source block.
 *
 * Unclaimed, Tab reaches the browser's focus traversal, and a note's own
 * contenteditable holds real tab stops (a checklist box, a block equation, a page
 * card's link), so the caret is thrown onto one of them and the next Space
 * toggles a to-do the user was not looking at. Source has an obvious job for the
 * key, so it does that job there and declines everywhere else, which leaves the
 * key free for a keymap below this one to give it another meaning (a list item's
 * indent, say).
 */

import { TextSelection, type Command, type EditorState, type Plugin } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';

/** One level of indentation in source. */
const INDENT = '  ';

interface SourceSelection {
  /** Document position of the source line's first content position. */
  readonly start: number;
  /** Selection bounds as offsets into that content. */
  readonly from: number;
  readonly to: number;
  /**
   * The line's text with one character per content position, so an offset means
   * the same thing to the string and to the document. An inline atom stands for
   * one of each, and source can legitimately carry one.
   */
  readonly text: string;
}

/** The selection when it lies inside one source line, or null when it does not. */
function sourceSelection(state: EditorState): SourceSelection | null {
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return null;
  const { $from, $to } = sel;
  const line = $from.parent;
  // `code` is the source line's own declaration, so a new source block type is
  // covered the day it is added.
  if (!line.type.spec.code || $to.parent !== line) return null;
  return {
    start: $from.start(),
    from: $from.parentOffset,
    to: $to.parentOffset,
    text: line.textBetween(0, line.content.size, undefined, '.'),
  };
}

/** Offsets of the first character of every visual line the selection touches. */
function coveredLineStarts(sel: SourceSelection): number[] {
  const starts: number[] = [];
  let at = sel.from === 0 ? 0 : sel.text.lastIndexOf('\n', sel.from - 1) + 1;
  for (;;) {
    starts.push(at);
    const next = sel.text.indexOf('\n', at);
    if (next < 0 || next >= sel.to) return starts;
    at = next + 1;
  }
}

/** Positions of indentation sitting at `at`, at most one level of it. */
function indentWidthAt(text: string, at: number): number {
  if (text[at] === '\t') return 1;
  let width = 0;
  while (width < INDENT.length && text[at + width] === ' ') width++;
  return width;
}

/** Tab: one level in, at the caret, or in front of every line a range covers. */
export const indentCodeLine: Command = (state, dispatch) => {
  const sel = sourceSelection(state);
  if (!sel) return false;
  if (dispatch) {
    const tr = state.tr;
    if (sel.from === sel.to) tr.insertText(INDENT, sel.start + sel.from);
    // Back to front, so the positions still ahead of an insert stay valid.
    else for (const at of coveredLineStarts(sel).reverse()) tr.insertText(INDENT, sel.start + at);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Shift+Tab: one level back off the front of every line the selection touches. */
export const outdentCodeLine: Command = (state, dispatch) => {
  const sel = sourceSelection(state);
  if (!sel) return false;
  const cuts = coveredLineStarts(sel)
    .map((at) => ({ at, width: indentWidthAt(sel.text, at) }))
    .filter((cut) => cut.width > 0);
  // Claimed even with nothing to remove: the alternative is handing the key back
  // to the browser, which moves focus off the caret.
  if (dispatch && cuts.length > 0) {
    const tr = state.tr;
    for (const cut of cuts.reverse()) {
      tr.delete(sel.start + cut.at, sel.start + cut.at + cut.width);
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** The source indent bindings, in prosemirror-keymap form. */
export function codeKeyBindings(): Record<string, Command> {
  return { Tab: indentCodeLine, 'Shift-Tab': outdentCodeLine };
}

/**
 * The source keymap plugin. It answers only for a caret inside a source line and
 * declines otherwise, so a keymap below it is free to give Tab another meaning
 * elsewhere in the document.
 */
export function codeKeymap(): Plugin {
  return keymap(codeKeyBindings());
}
