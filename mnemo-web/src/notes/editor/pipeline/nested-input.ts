/**
 * The editor's key and clipboard handling defers to a plain text input inside it.
 *
 * The editor is one contentEditable, but not everything inside it is document
 * content: the equation source popover is a real `<input>`, and later surfaces
 * will be too. Events there bubble to `view.dom` like any other, so without this
 * every editor binding fires on them, `Mod-z` in the equation source would undo
 * the *note*, `Mod-b` would embolden the text behind the popover, and a paste
 * would land in the document rather than in the field the caret is in.
 *
 * ## One predicate, and the reason there is only one
 *
 * The desktop asked this question in two places and got two different answers.
 * `NotesView.Keybinds.cs:117-121` matched a `TextBox` anywhere in the window,
 * including the note title and the sidebar's rename field, because it gated a
 * *window-level* Ctrl+Z router that had to keep its hands off every text field in
 * the app. `BlockEditor.Clipboard.cs:75-81` matched only a `TextBox` the editor
 * itself contained, because it gated the editor's own handler. Neither was wrong
 * for its own gate; having two of them was.
 *
 * Here there is one gate, so there is one predicate. The window-level half of the
 * problem does not exist: these bindings live on the note's `EditorState` and
 * fire only while its view holds the selection, so a field elsewhere in the app
 * is already out of reach. What remains is exactly the narrower question, is
 * this event coming from a text input the editor contains, and that is the one
 * this asks.
 *
 * ## Declining is not handling
 *
 * The guard reports the event as handled so ProseMirror's own handlers stand
 * down, and deliberately does not `preventDefault`: the browser still delivers
 * the keystroke to the input, which is the whole point. That is why this hooks
 * `handleDOMEvents` and not `handleKeyDown`, ProseMirror calls `preventDefault`
 * on a `handleKeyDown` that returns true, which would swallow the character
 * before the field ever saw it.
 */

import { Plugin } from 'prosemirror-state';

/**
 * Whether an event came from a plain text field rather than from document
 * content. A `contenteditable` is not one of these: that is how the document
 * itself is edited, and ProseMirror owns it.
 */
export function isNestedTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

const defer = (_view: unknown, event: Event): boolean => isNestedTextInput(event.target);

/**
 * The guard plugin. Include it **first**, it can only stand the other plugins
 * down if it is asked before them.
 *
 * The six events are the ones ProseMirror would otherwise turn into a document
 * change. The first three drive typing and every keymap; the last three are the
 * document's own clipboard handling, which a field inside it must own instead.
 */
export function nestedInputGuard(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        keydown: defer,
        keypress: defer,
        beforeinput: defer,
        paste: defer,
        cut: defer,
        copy: defer,
      },
    },
  });
}
