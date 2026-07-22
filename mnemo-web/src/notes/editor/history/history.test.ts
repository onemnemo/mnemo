// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { splitBlock } from '../commands/structure';
import { toggleFormat } from '../marks/commands';
import { redo, undo } from './history';
import { asOwnUndoStep, historyBoundaryPlugin } from './boundaries';

/** The editable state a note opens with, with history wired exactly as it ships. */
function stateFor(...blocks: Parameters<typeof buildNoteEditState>[0][number][]): EditorState {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  return built.state;
}

/** Runs a command the way a keypress does, returning the state it produced. */
function run(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
): EditorState {
  let next = state;
  const applied = command(state, (tr) => {
    next = state.apply(tr);
  });
  expect(applied).toBe(true);
  return next;
}

/** Types text at the caret, as one transaction, one keystroke's worth. */
function type(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text));
}

function caretAt(state: EditorState, pos: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function textOf(state: EditorState): string {
  return state.doc.textBetween(0, state.doc.content.size, '\n');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('typing runs', () => {
  it('coalesces successive keystrokes into one undo step', () => {
    let state = caretAt(stateFor(block('Text', [span('')])), 2);
    for (const ch of 'hello') state = type(state, ch);
    expect(textOf(state)).toBe('hello');

    state = run(state, undo);

    // Five keystrokes, one press to take them all back, the desktop's open
    // typing batch, expressed as a group rather than as an object.
    expect(textOf(state)).toBe('');
  });

  it('starts a new run once the caret has been idle past the delay', () => {
    vi.useFakeTimers();
    let state = caretAt(stateFor(block('Text', [span('')])), 2);
    state = type(state, 'ab');
    vi.advanceTimersByTime(400);
    state = type(state, 'cd');

    state = run(state, undo);

    expect(textOf(state)).toBe('ab');
  });

  it('keeps a run going across a gap shorter than the delay', () => {
    vi.useFakeTimers();
    let state = caretAt(stateFor(block('Text', [span('')])), 2);
    state = type(state, 'ab');
    vi.advanceTimersByTime(100);
    state = type(state, 'cd');

    state = run(state, undo);

    expect(textOf(state)).toBe('');
  });

  it('ends a run when the next edit lands somewhere else', () => {
    let state = stateFor(block('Text', [span('one')]), block('Text', [span('two')]));
    state = type(caretAt(state, 5), 'X');
    state = type(caretAt(state, state.doc.content.size - 1), 'Y');

    state = run(state, undo);

    // No explicit boundary does this, ProseMirror ends a run at an edit that is
    // not adjacent to the last one, which is what a block switch always is.
    expect(textOf(state)).toBe('oneX\ntwo');
  });
});

describe('discrete edits', () => {
  it('takes back a split without taking back the typing before it', () => {
    let state = caretAt(stateFor(block('Text', [span('')])), 2);
    for (const ch of 'ab') state = type(state, ch);
    state = run(state, splitBlock);
    expect(state.doc.childCount).toBe(2);

    state = run(state, undo);

    expect(state.doc.childCount).toBe(1);
    expect(textOf(state)).toBe('ab');
  });

  it('does not join the typing that follows it either', () => {
    let state = caretAt(stateFor(block('Text', [span('ab')])), 4);
    state = run(state, splitBlock);
    state = type(state, 'c');

    state = run(state, undo);

    // Still two blocks: the first press took back only what was typed after the
    // split. The desktop got this from pushing the structural operation and
    // opening a fresh typing batch after it.
    expect(state.doc.childCount).toBe(2);
    expect(textOf(state)).toBe('ab\n');
  });

  it('undoes a repaired edit and its repair together', () => {
    // Splitting a heading leaves the heading holding "ab", which the invariant
    // pipeline then forces bold in a transaction of its own. If the boundary
    // closed the group before that repair appended, the repair would become a
    // second undo step and one press would leave the text bold.
    let state = caretAt(stateFor(block('Heading2', [span('abcd')])), 4);
    state = run(state, splitBlock);
    expect(state.doc.child(0).textContent).toBe('ab');

    state = run(state, undo);

    expect(state.doc.childCount).toBe(1);
    const line = state.doc.child(0).child(0);
    expect(line.textContent).toBe('abcd');
    expect(line.child(0).marks).toHaveLength(0);
  });

  it('treats formatting a selection as its own step', () => {
    let state = caretAt(stateFor(block('Text', [span('')])), 2);
    for (const ch of 'abc') state = type(state, ch);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 5)));
    state = run(state, toggleFormat('bold'));

    state = run(state, undo);

    expect(textOf(state)).toBe('abc');
    expect(state.doc.child(0).child(0).child(0).marks).toHaveLength(0);
  });

  it('does not cut the run when a mark is only armed for the next character', () => {
    let state = caretAt(stateFor(block('Text', [span('')])), 2);
    state = type(state, 'a');
    state = run(state, toggleFormat('bold'));
    state = type(state, 'b');

    state = run(state, undo);

    // Arming a mark changes no document; making it a boundary would split a
    // single word into two undo steps.
    expect(textOf(state)).toBe('');
  });
});

describe('redo', () => {
  it('puts back exactly what undo took', () => {
    let state = caretAt(stateFor(block('Text', [span('')])), 2);
    for (const ch of 'hi') state = type(state, ch);
    state = run(state, undo);
    state = run(state, redo);

    expect(textOf(state)).toBe('hi');
  });

  it('is unavailable once a new edit lands on top', () => {
    let state = caretAt(stateFor(block('Text', [span('')])), 2);
    state = type(state, 'a');
    state = run(state, undo);
    state = type(state, 'b');

    expect(redo(state)).toBe(false);
  });
});

describe('identity across undo', () => {
  it('gives a block its sid back rather than minting a new one', () => {
    let state = caretAt(stateFor(block('Text', [span('ab')])), 4);
    state = run(state, splitBlock);
    const sid = String(state.doc.child(1).attrs.sid);
    expect(sid).not.toBe('');

    state = run(state, undo);
    state = run(state, redo);

    // A re-minted sid is one the AI may already have named in chat, so a block
    // that comes back has to come back as itself.
    expect(String(state.doc.child(1).attrs.sid)).toBe(sid);
  });
});

describe('undo restores where you were', () => {
  it('puts the caret back where the run started', () => {
    let state = caretAt(stateFor(block('Text', [span('abc')])), 3);
    state = type(state, 'XY');
    expect(state.selection.from).toBe(5);

    state = run(state, undo);

    expect(state.selection.from).toBe(3);
  });
});

describe('the boundary plugin', () => {
  it('keeps the typing after a paste out of it', () => {
    let state = caretAt(stateFor(block('Text', [span('')])), 2);
    state = type(state, 'ab');
    state = state.apply(state.tr.insertText('P').setMeta('uiEvent', 'paste'));
    state = type(state, 'c');

    state = run(state, undo);

    // The far side of the fence, which is the half a headless apply can show:
    // 'c' did not join the paste. The near side is a DOM handler, covered below.
    expect(textOf(state)).toBe('abP');
  });

  it('closes the group before the event ProseMirror is about to handle', () => {
    const state = stateFor(block('Text', [span('ab')]));
    const dispatched: Transaction[] = [];
    const plugin = historyBoundaryPlugin();
    const handled = plugin.props.handleDOMEvents!.paste!(
      { state, dispatch: (tr: Transaction) => dispatched.push(tr) } as never,
      new Event('paste') as ClipboardEvent,
    );

    // Declined, so ProseMirror still does the paste itself, the handler exists
    // only to fence the group off first.
    expect(handled).toBe(false);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].steps).toHaveLength(0);
  });

  it('leaves an ordinary transaction alone', () => {
    const state = stateFor(block('Text', [span('ab')]));
    const plugin = historyBoundaryPlugin();
    const tr = state.tr.insertText('c', 3);

    expect(plugin.spec.appendTransaction!.call(plugin, [tr], state, state.apply(tr))).toBeNull();
  });

  it('marks a transaction it is given as a boundary', () => {
    const state = stateFor(block('Text', [span('ab')]));
    const plugin = historyBoundaryPlugin();
    const tr = asOwnUndoStep(state.tr.insertText('c', 3));

    expect(
      plugin.spec.appendTransaction!.call(plugin, [tr], state, state.apply(tr)),
    ).not.toBeNull();
  });
});
