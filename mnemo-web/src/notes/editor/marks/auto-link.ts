/**
 * Turns a completed URL or email into a link while the user types.
 *
 * Detection runs only when a delimiter finishes the token, never on every
 * character. The URL stays ordinary text until that point, so the
 * non-inclusive link mark cannot split a half-typed address. Paste uses the
 * markdown path and reaches the same URL detector separately.
 */

import { Plugin, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { findAutoLinks } from '../../model/autolink';

const TOKEN_TRAILER = /^[.,;:!?)]*$/;

interface LinkRange {
  readonly from: number;
  readonly to: number;
  readonly href: string;
}

/** The last complete URL before the caret, excluding sentence punctuation. */
function linkBeforeCaret(state: EditorState): LinkRange | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.$cursor) return null;
  const { $cursor } = selection;
  if (!$cursor.parent.isTextblock || !state.schema.marks.link) return null;

  const before = $cursor.parent.textBetween(0, $cursor.parentOffset, '\ufffc', '\ufffc');
  const candidates = findAutoLinks(before);
  const candidate = candidates.at(-1);
  if (!candidate || !TOKEN_TRAILER.test(before.slice(candidate.end))) return null;

  const from = $cursor.start() + candidate.start;
  const to = $cursor.start() + candidate.end;
  let eligible = true;
  let alreadyLinked = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isInline) return true;
    if (!node.isText || node.marks.some((mark) => mark.type.name === 'codeMark' || mark.type.name === 'noAutoLink')) {
      eligible = false;
      return false;
    }
    const link = node.marks.find((mark) => mark.type.name === 'link');
    if (link && String(link.attrs.href).toLowerCase() !== candidate.href.toLowerCase()) {
      eligible = false;
      return false;
    }
    if (!link) alreadyLinked = false;
    return false;
  });

  return eligible && !alreadyLinked ? { from, to, href: candidate.href } : null;
}

function addLink(state: EditorState, range: LinkRange, tr: Transaction = state.tr): Transaction {
  return tr.addMark(range.from, range.to, state.schema.marks.link.create({ href: range.href }));
}

function finishBeforeEnter(view: EditorView): boolean {
  const range = linkBeforeCaret(view.state);
  if (!range) return false;
  view.dispatch(addLink(view.state, range).setMeta('addToHistory', false));
  return false;
}

export function autoLinkPlugin(): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (view.composing || from !== to || !/\s$/u.test(text)) return false;
        const range = linkBeforeCaret(view.state);
        if (!range) return false;

        const tr = view.state.tr.insertText(text, from, to);
        view.dispatch(addLink(view.state, range, tr));
        return true;
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey) return false;
        return finishBeforeEnter(view);
      },
    },
  });
}
