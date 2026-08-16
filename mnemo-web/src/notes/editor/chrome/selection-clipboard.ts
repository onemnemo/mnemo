/**
 * Copy and cut for the editor's right-click menu.
 *
 * Both go through `document.execCommand`, so a real ClipboardEvent reaches the
 * clipboard plugin: the one place that writes all three payloads (the exact
 * slice, the HTML carrying its nonce, and Mnemo markdown) and the one place that
 * folds a cut's delete into a single undo step. Nothing here duplicates it.
 *
 * There is no Paste row. `execCommand('paste')` is refused for web content in
 * Chromium, and `navigator.clipboard.read()` needs the clipboard-read
 * permission, which WebView2 answers with a prompt of its own while the host
 * installs no permission handler. A row that opens a system prompt half the time
 * is worse than no row. Ctrl+V is untouched: a real key press delivers the paste
 * event the plugin already handles.
 */

import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { getBlockSelection } from '../../selection/block-selection-plugin';

/**
 * Whether the clipboard verbs have a text range (or a selected atom) to act on.
 *
 * A block selection is excluded deliberately: `execCommand` needs a DOM range,
 * and a block selection leaves the DOM caret collapsed, so the verb would look
 * available and copy nothing. Ctrl+C still covers that case, because the key
 * press produces the clipboard event without the command.
 */
export function hasClipboardSelection(state: EditorState): boolean {
  return !state.selection.empty && getBlockSelection(state).selected.size === 0;
}

/**
 * Focus the editor and run the browser's own clipboard command.
 *
 * The focus has to happen inside the same task as the command: the menu took
 * focus when it opened, and `execCommand` acts on whatever is focused now.
 */
export function runClipboardVerb(view: EditorView, verb: 'copy' | 'cut'): boolean {
  view.focus();
  return document.execCommand(verb);
}
