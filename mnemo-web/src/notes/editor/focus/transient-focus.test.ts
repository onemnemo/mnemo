// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';

import { openTransientFocus } from './transient-focus';
import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';

function mockView(state: EditorState) {
  const view = {
    state,
    dispatch: vi.fn((tr: Transaction) => {
      view.state = view.state.apply(tr);
    }),
    focus: vi.fn(),
  };
  return view;
}

function editState() {
  const result = buildNoteEditState([
    block('Text', [span('one two three')]),
    block('Text', [span('four five six')]),
  ]);
  if (!result.ok) throw new Error('fixture failed to build');
  return result.state;
}

describe('openTransientFocus', () => {
  it('restores the selection a later transaction moved away from', () => {
    const view = mockView(editState());
    const original = TextSelection.create(view.state.doc, 3, 6);
    view.dispatch(view.state.tr.setSelection(original));

    const scope = openTransientFocus(view);
    // Something else (the transient UI's own filtering, say) moves the caret.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 20)));

    scope.restore();

    expect(view.state.selection.from).toBe(3);
    expect(view.state.selection.to).toBe(6);
    expect(view.focus).toHaveBeenCalledOnce();
  });

  it('restores a NodeSelection, not just a text range', () => {
    const view = mockView(editState());
    const nodeSelection = NodeSelection.create(view.state.doc, 0);
    view.dispatch(view.state.tr.setSelection(nodeSelection));

    const scope = openTransientFocus(view);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));

    scope.restore();

    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(0);
  });

  it('release() stands down without touching the selection', () => {
    const view = mockView(editState());
    const scope = openTransientFocus(view);

    const afterAction = TextSelection.create(view.state.doc, 10);
    view.dispatch(view.state.tr.setSelection(afterAction));
    scope.release();

    expect(view.state.selection.from).toBe(afterAction.from);
    expect(view.dispatch).toHaveBeenCalledTimes(1); // only the caller's own dispatch above
    expect(view.focus).not.toHaveBeenCalled();
  });

  it('resolves only once — restore() after release() is a no-op', () => {
    const view = mockView(editState());
    const original = view.state.selection;
    const scope = openTransientFocus(view);
    scope.release();

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 15)));
    scope.restore();

    // restore() did nothing: the dispatch above is the only one, and focus()
    // (which only restore() calls) never ran.
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(view.focus).not.toHaveBeenCalled();
    expect(original).toBeDefined();
  });

  it('resolves only once — a second restore() is a no-op', () => {
    const view = mockView(editState());
    const scope = openTransientFocus(view);
    scope.restore();
    const dispatchCallsAfterFirst = view.dispatch.mock.calls.length;
    const focusCallsAfterFirst = view.focus.mock.calls.length;

    scope.restore();

    expect(view.dispatch.mock.calls.length).toBe(dispatchCallsAfterFirst);
    expect(view.focus.mock.calls.length).toBe(focusCallsAfterFirst);
  });

  it('skips a redundant selection dispatch when nothing moved it, but still refocuses', () => {
    const view = mockView(editState());
    const scope = openTransientFocus(view);
    scope.restore();
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalledOnce();
  });

  it('falls back to focusing without a selection change when the snapshot no longer resolves', () => {
    const view = mockView(editState());
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 20)));
    const scope = openTransientFocus(view);

    // Collapse the document out from under the snapshot: the captured position
    // (20) is now well past the end of a doc this short.
    view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
    const beforeRestore = view.state.selection.from;

    scope.restore();

    // No exception, no dispatch beyond the collapse above, focus still runs.
    expect(view.state.selection.from).toBe(beforeRestore);
    expect(view.dispatch).toHaveBeenCalledTimes(2); // the two dispatches above only
    expect(view.focus).toHaveBeenCalledOnce();
  });
});
