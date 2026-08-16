// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TextSelection, type EditorState } from 'prosemirror-state';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { blockSelectionKey } from '../../selection/block-selection-plugin';
import { block, span } from '../mapper/fixtures';
import { hasClipboardSelection } from './selection-clipboard';

function mount(): EditorState {
  const built = buildNoteEditState([block('Text', [span('one')]), block('Text', [span('two')])]);
  if (!built.ok) throw new Error('fixture did not build');
  return built.state;
}

/** A text range over the first block's word. */
function ranged(state: EditorState): EditorState {
  const tr = state.tr;
  return state.apply(tr.setSelection(TextSelection.create(tr.doc, 1, 4)));
}

function blockSelected(state: EditorState, sids: string[]): EditorState {
  return state.apply(
    state.tr.setMeta(blockSelectionKey, {
      type: 'set',
      selection: { selected: new Set(sids), anchorSid: sids[0] ?? null },
    }),
  );
}

describe('hasClipboardSelection', () => {
  it('is false on a bare caret', () => {
    expect(hasClipboardSelection(mount())).toBe(false);
  });

  it('is true on a text range', () => {
    expect(hasClipboardSelection(ranged(mount()))).toBe(true);
  });

  it('is false on a block selection, whose DOM caret is collapsed', () => {
    const state = mount();
    expect(hasClipboardSelection(blockSelected(state, [String(state.doc.child(0).attrs.sid)]))).toBe(false);
  });
});
