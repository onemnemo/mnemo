/**
 * Cut, copy and paste for the editor's right-click menu.
 *
 * Cut and copy go through `document.execCommand`, so a real ClipboardEvent
 * reaches the clipboard plugin: the one place that writes all three payloads
 * (the exact slice, the HTML carrying its nonce, and Mnemo markdown) and the one
 * place that folds a cut's delete into a single undo step. Nothing here
 * duplicates it.
 *
 * Paste cannot borrow the same command, because `execCommand('paste')` is
 * refused for web content in Chromium. It reads the clipboard through the async
 * API instead and hands the result to the same pipeline, as a paste event
 * dispatched on the editor's own DOM, so image restaging, sanitising and
 * placement all happen exactly as they do for Ctrl+V. Building a slice here and
 * inserting it would be a second paste path, and the two would drift.
 *
 * The async read cannot carry the private slice-as-JSON type: it answers with a
 * fixed set of standard types and drops everything else. The nonce rides in the
 * HTML as well, so a copy made in this session still pastes back as the exact
 * slice from the buffer; a copy from a previous run reparses its HTML, the same
 * as any other app's.
 */

import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { getBlockSelection } from '../../selection/block-selection-plugin';

/** The types worth carrying into a paste event; nothing else has a handler behind it. */
function isUsableType(type: string): boolean {
  return type === 'text/plain' || type === 'text/html' || type.startsWith('image/');
}

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

/**
 * Whether a Paste row can be drawn at all.
 *
 * Reading the clipboard needs the clipboard-read permission. The window grants
 * every permission its engine asks it about, so on the WebView2 and WebKitGTK
 * builds the read is answered with no dialog and the row is honest. WKWebView
 * asks the app about nothing and decides clipboard reads itself, by putting its
 * own paste confirmation under the pointer, so on Apple platforms there is no
 * row: a menu item that opens a second thing to click is worse than none, and
 * Ctrl+V is untouched everywhere.
 *
 * Read at call time rather than captured at module load, so a test asserts
 * against the platform it names and not against the machine it runs on.
 */
export function canPasteFromMenu(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)) return false;
  return (
    typeof navigator.clipboard?.read === 'function' &&
    typeof DataTransfer === 'function' &&
    typeof ClipboardEvent === 'function'
  );
}

/**
 * Paste the clipboard into the document through the editor's own paste handling.
 *
 * Answers whether anything claimed the event. A clipboard the engine will not
 * hand over, or one holding nothing a handler could use, leaves the document
 * untouched: ProseMirror answers an unclaimed paste event by focusing a hidden
 * element and waiting for the engine to fill it, which a synthesised event never
 * will, so it must not see one.
 */
export async function runPasteVerb(view: EditorView): Promise<boolean> {
  const data = await readClipboardTransfer();
  if (!data) return false;

  view.focus();
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  // The handlers sit on the editor's own node, and a paste that lands is a paste
  // that was prevented.
  return !view.dom.dispatchEvent(event);
}

async function readClipboardTransfer(): Promise<DataTransfer | null> {
  let items: readonly ClipboardItem[];
  try {
    items = await navigator.clipboard.read();
  } catch {
    return null;
  }

  const data = new DataTransfer();
  let carried = false;
  for (const item of items) {
    for (const type of item.types) {
      if (!isUsableType(type)) continue;
      try {
        const blob = await item.getType(type);
        if (type.startsWith('image/')) {
          data.items.add(new File([blob], `clipboard.${type.slice('image/'.length)}`, { type }));
        } else {
          data.setData(type, await blob.text());
        }
        carried = true;
      } catch {
        // One type the engine cannot decode is not the whole clipboard; the rest
        // of it still pastes.
      }
    }
  }
  return carried ? data : null;
}
