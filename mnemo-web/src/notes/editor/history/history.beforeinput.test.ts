// @vitest-environment jsdom

import { TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { isHistoryRestore } from './history';

/** The input event a browser fires for its own Edit menu or context menu undo and redo. */
function historyInput(view: EditorView, inputType: 'historyUndo' | 'historyRedo'): Event {
  const event = Object.assign(new Event('beforeinput', { bubbles: true, cancelable: true }), { inputType });
  view.dom.dispatchEvent(event);
  return event;
}

describe('undo and redo from the browser', () => {
  it('are tagged as restores like the keyboard ones', () => {
    const built = buildNoteEditState([block('Text', [span('')])]);
    if (!built.ok) throw new Error('fixture did not build');
    const seen: Transaction[] = [];
    const view = new EditorView(document.createElement('div'), {
      state: built.state,
      dispatchTransaction(tr) {
        seen.push(tr);
        view.updateState(view.state.apply(tr));
      },
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    view.dispatch(view.state.tr.insertText('hi'));

    const undone = historyInput(view, 'historyUndo');
    expect(undone.defaultPrevented).toBe(true);
    expect(view.state.doc.textContent).toBe('');
    expect(isHistoryRestore(seen[seen.length - 1])).toBe(true);

    const redone = historyInput(view, 'historyRedo');
    expect(redone.defaultPrevented).toBe(true);
    expect(view.state.doc.textContent).toBe('hi');
    expect(isHistoryRestore(seen[seen.length - 1])).toBe(true);
    view.destroy();
  });
});
