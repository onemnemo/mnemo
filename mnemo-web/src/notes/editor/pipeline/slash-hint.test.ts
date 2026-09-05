// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, Selection, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { DecorationSet, type EditorView } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { slashHintPlugin } from './slash-hint';

const { schema } = createEditorSchema();
const plugin = slashHintPlugin();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const paragraph = (text?: string) => schema.nodes.paragraph.create({ sid: 'p', id: 'p' }, line(text));
const heading = () => schema.nodes.heading.create({ sid: 'h', id: 'h', level: 1 }, line());
const docOf = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

function hintCount(state: EditorState): number {
  const set = plugin.props.decorations!.call(plugin, state) as DecorationSet | null;
  return set ? set.find().length : 0;
}

/**
 * Focus and blur through the plugin's own DOM handlers, the entry point the view
 * uses, since whether the editor has focus is not something the state can be
 * asked and the hint now depends on it.
 */
function setFocus(state: EditorState, focused: boolean): EditorState {
  const view = {
    state,
    dispatch(tr: import('prosemirror-state').Transaction) {
      view.state = view.state.apply(tr);
    },
  };
  const handlers = plugin.props.handleDOMEvents!;
  const handler = focused ? handlers.focus! : handlers.blur!;
  handler.call(plugin, view as unknown as EditorView, {} as FocusEvent);
  return view.state;
}

/** Hints drawn with the caret collapsed at the end of a focused document. */
function hintsAtEnd(doc: PMNode): number {
  let state = EditorState.create({ schema, doc, plugins: [plugin] });
  state = state.apply(state.tr.setSelection(Selection.atEnd(state.doc)));
  return hintCount(setFocus(state, true));
}

describe('slashHintPlugin', () => {
  it('draws a hint on a focused empty paragraph', () => {
    expect(hintsAtEnd(docOf(paragraph()))).toBe(1);
  });

  it('draws nothing once the paragraph has text', () => {
    expect(hintsAtEnd(docOf(paragraph('hello')))).toBe(0);
  });

  it('draws nothing for a non-empty selection', () => {
    let state = EditorState.create({ schema, doc: docOf(paragraph('hello')), plugins: [plugin] });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 5)));
    expect(hintCount(setFocus(state, true))).toBe(0);
  });

  it('draws nothing while the editor has no focus', () => {
    // A prompt for the next keystroke, on a block nobody is typing into: the
    // caret stays where it was when the reader clicked into the sidebar.
    let state = EditorState.create({ schema, doc: docOf(paragraph()), plugins: [plugin] });
    state = state.apply(state.tr.setSelection(Selection.atEnd(state.doc)));
    expect(hintCount(state)).toBe(0);
    expect(hintCount(setFocus(state, true))).toBe(1);
    expect(hintCount(setFocus(setFocus(state, true), false))).toBe(0);
  });

  it('does not hint an empty heading, which means something on its own', () => {
    expect(hintsAtEnd(docOf(heading()))).toBe(0);
  });

  it('only hints the empty block the caret is in', () => {
    // Caret lands in the second empty paragraph: exactly one hint, on that block.
    expect(hintsAtEnd(docOf(paragraph(), paragraph()))).toBe(1);
  });
});
