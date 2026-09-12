import { keymap } from 'prosemirror-keymap';
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { asOwnUndoStep } from '../history';
import { clearStoredScripts, currentMarks, scriptMarkName, withoutScriptMarks } from './marks';
import { convertPendingScriptShortcut } from './shortcuts';

const focusKey = new PluginKey<boolean>('notes-script-assistance-focus');

function armedScript(state: EditorState): 'sub' | 'sup' | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.$cursor || !state.storedMarks) return null;
  return scriptMarkName(state.storedMarks);
}

function scriptHint(state: EditorState): DecorationSet | null {
  if (focusKey.getState(state) !== true) return null;
  const script = armedScript(state);
  if (!script) return null;
  return DecorationSet.create(state.doc, [
    Decoration.widget(
      state.selection.from,
      () => {
        const hint = document.createElement('span');
        hint.className = 'notes-script-hint';
        hint.dataset.scriptHint = script === 'sup' ? 'x²' : 'x₂';
        hint.setAttribute('aria-hidden', 'true');
        return hint;
      },
      { key: `notes-script-${script}`, side: 1 },
    ),
  ]);
}

export function scriptAssistancePlugin(): Plugin<boolean> {
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
      handleTextInput(view, from, to, text) {
        if (text !== ' ' || from !== to || view.composing) return false;
        const selection = view.state.selection;
        if (!(selection instanceof TextSelection) || !selection.$cursor) return false;
        const marks = currentMarks(view.state);
        if (!scriptMarkName(marks)) return false;
        const remaining = withoutScriptMarks(marks);
        view.dispatch(
          view.state.tr
            .setStoredMarks(remaining)
            .insertText(text, from, to)
            .setStoredMarks(remaining)
            .scrollIntoView(),
        );
        return true;
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || event.isComposing || view.composing) return false;
        const tr = convertPendingScriptShortcut(view.state);
        if (!tr) return false;
        view.dispatch(asOwnUndoStep(tr.scrollIntoView()));
        return false;
      },
      decorations: scriptHint,
    },
  });
}

export function scriptEscapeKeymap(): Plugin {
  return keymap({ Escape: clearStoredScripts });
}
