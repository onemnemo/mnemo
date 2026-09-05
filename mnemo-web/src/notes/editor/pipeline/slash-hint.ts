/**
 * The empty-line hint: a faint "type / for commands" on the focused empty
 * paragraph, so a blank note and a freshly emptied block invite a first keystroke
 * rather than reading as broken.
 *
 * A decoration, never real content: it must not enter the document, the save, or
 * the text projection. It attaches to the line element of an empty paragraph that
 * holds the collapsed caret, and CSS draws it as `::before`, so the contentEditable
 * stays genuinely empty and one keystroke clears it. Only a plain paragraph gets
 * it; a blank heading or list item means something on its own.
 *
 * The text is read from the shared i18n bundle rather than threaded through the
 * plugin stack, the same outside-React translate the app uses elsewhere. A
 * language switch refreshes it on the next transaction, which is the next
 * keystroke; the hint is only ever visible on an empty block about to be typed in.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { useI18nStore } from '@/i18n/store';
import { createTranslate } from '@/i18n/translate';

function hintText(): string {
  return createTranslate(useI18nStore.getState().bundle)('Notes', 'editor.slashHint');
}

/**
 * Whether the editor holds DOM focus, which the decoration cannot ask the state
 * for. The hint invites the next keystroke, so it belongs to the caret that is
 * about to take one; left up while the reader is in the sidebar or the tab bar
 * it is a prompt aimed at nobody, on a block that merely happens to be empty.
 */
const focusKey = new PluginKey<boolean>('notes-slash-hint-focus');

export function slashHintPlugin(): Plugin {
  return new Plugin<boolean>({
    key: focusKey,
    state: {
      init: () => false,
      apply: (tr, focused) => (tr.getMeta(focusKey) as boolean | undefined) ?? focused,
    },
    props: {
      handleDOMEvents: {
        focus(view) {
          view.dispatch(view.state.tr.setMeta(focusKey, true));
          return false;
        },
        blur(view) {
          view.dispatch(view.state.tr.setMeta(focusKey, false));
          return false;
        },
      },
      decorations(state) {
        if (focusKey.getState(state) !== true) return null;
        const sel = state.selection;
        if (!sel.empty) return null;

        const $from = sel.$from;
        const line = $from.parent;
        if (line.type.name !== 'line' || line.content.size > 0) return null;

        const block = $from.node($from.depth - 1);
        if (!block || block.type.name !== 'paragraph') return null;

        const start = $from.before();
        return DecorationSet.create(state.doc, [
          Decoration.node(start, start + line.nodeSize, {
            class: 'notes-empty-hint',
            'data-placeholder': hintText(),
          }),
        ]);
      },
    },
  });
}
