/**
 * Where the caret goes when a note is opened, and when it is left alone.
 *
 * Opening a note used to leave focus wherever the click that opened it landed,
 * a tree row or a tab, so the document rendered and the next keystroke went
 * nowhere. It is worst on a brand new note, where the "type / for commands"
 * hint is a decoration on the block holding the caret: with no caret there is
 * no hint either, and the page offers no prompt of any kind.
 *
 * Two things may be doing something more important than the note, and both
 * keep what they have: a dialog on screen, and a field somebody is typing in
 * (the tree's search box is the one that matters, since filtering the tree is
 * how a note gets opened in the first place).
 */

import { Selection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { isModalOpen } from '@/lib/modal';
import { lineIsCaretTarget, lineOf } from '../blocks/shared';

/** Input types that hold typed text, as opposed to a button or a checkbox. */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'url',
  'email',
  'tel',
  'password',
  'number',
]);

/**
 * The first position in the document a caret can actually be seen in.
 *
 * Not simply the document start: the first block may be a divider, an image or
 * a table, and every one of those either draws nothing at the position or is
 * structural scenery whose line the reader cannot see. `Selection.findFrom`
 * settles the offsets from the block's own position rather than assuming the
 * line is always one node in.
 */
export function initialCaret(doc: PMNode): Selection {
  let found: Selection | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    // A container carries no line of its own, so its children are what get asked.
    if (!lineOf(node)) return true;
    if (lineIsCaretTarget(node.type)) found = Selection.findFrom(doc.resolve(pos), 1, true);
    return false;
  });
  return found ?? Selection.atStart(doc);
}

/** Whether something outside the editor is holding typed text. */
function typingElsewhere(view: EditorView): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || view.dom.contains(active)) return false;
  if (active instanceof HTMLTextAreaElement || active.isContentEditable) return true;
  return active instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(active.type);
}

/**
 * Puts the caret in a freshly opened note and takes the keyboard with it.
 *
 * `view.focus` prevents the scroll a focus would otherwise cause, so a note
 * opened at its cover stays at its cover. The selection is set through
 * `dispatch` rather than written into the state, so the plugins that read the
 * caret (the empty-line hint among them) see it arrive.
 */
export function focusNoteOnOpen(view: EditorView): void {
  if (!view.editable || view.hasFocus()) return;
  if (isModalOpen() || typingElsewhere(view)) return;

  const selection = initialCaret(view.state.doc);
  if (!selection.eq(view.state.selection)) {
    view.dispatch(view.state.tr.setSelection(selection));
  }
  view.focus();
}
