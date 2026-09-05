// @vitest-environment jsdom

/**
 * Escape on a marked run of text, and the escalation it sits at the bottom of.
 * The command itself is two lines; what is worth pinning is that it is reached
 * only when nothing above it wants the key, which is a property of where the
 * keymap is mounted rather than of the command.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { dispatchFind, getFindState } from '../../find/find-plugin';
import {
  blockSelectionKey,
  getBlockSelection,
} from '../../selection/block-selection-plugin';
import { collapseTextSelection } from './collapse-selection';

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(): EditorView {
  const built = buildNoteEditState([block('Text', [span('hello there')])]);
  if (!built.ok) throw new Error('fixture did not build');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView(container, { state: built.state });
  views.push(view);
  return view;
}

function selectRange(view: EditorView, from: number, to: number): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

function press(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return view.someProp('handleKeyDown', (f) => f(view, event)) === true;
}

function sidOf(doc: PMNode): string {
  return String(doc.child(0).attrs.sid);
}

describe('Escape with a run of text marked', () => {
  it('collapses to the head, the end the selection was growing from', () => {
    const view = mount();
    selectRange(view, 2, 7);
    expect(press(view, 'Escape')).toBe(true);
    expect(view.state.selection.empty).toBe(true);
    expect(view.state.selection.from).toBe(7);
    expect(view.state.doc.child(0).textContent).toBe('hello there');
  });

  it('declines a caret, so Escape keeps meaning nothing there', () => {
    const view = mount();
    selectRange(view, 4, 4);
    expect(press(view, 'Escape')).toBe(false);
  });
});

describe('what claims Escape first', () => {
  it('closes find rather than collapsing the run under it', () => {
    const view = mount();
    selectRange(view, 2, 7);
    dispatchFind(view, { type: 'open' });
    expect(press(view, 'Escape')).toBe(true);
    expect(getFindState(view.state).open).toBe(false);
    // Still marked: the press was find's, and the next one is the run's.
    expect(view.state.selection.empty).toBe(false);
    expect(press(view, 'Escape')).toBe(true);
    expect(view.state.selection.empty).toBe(true);
  });

  it('clears a block selection rather than collapsing anything', () => {
    const view = mount();
    view.dispatch(
      view.state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set([sidOf(view.state.doc)]), anchorSid: sidOf(view.state.doc) },
      }),
    );
    expect(press(view, 'Escape')).toBe(true);
    expect(getBlockSelection(view.state).selected.size).toBe(0);
  });
});

describe('collapseTextSelection', () => {
  it('is a selection change and nothing else, so it never dirties the note', () => {
    const view = mount();
    selectRange(view, 2, 7);
    let changed = false;
    collapseTextSelection(view.state, (tr) => {
      changed = tr.docChanged;
    });
    expect(changed).toBe(false);
  });
});
