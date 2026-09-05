// @vitest-environment jsdom

/**
 * Where the caret lands when a note opens, and the two things that keep it
 * where it is instead.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { block, span } from '../mapper/fixtures';
import type { Block } from '../../model/types';
import { focusNoteOnOpen, initialCaret } from './open-focus';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

beforeAll(() => {
  (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
});

afterEach(() => {
  document.body.replaceChildren();
});

function docOf(blocks: Block[]) {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

function mount(blocks: Block[], editable = true): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, {
    state: EditorState.create({ doc: docOf(blocks), schema }),
    editable: () => editable,
  });
}

/** The block the caret ended up in, named rather than counted in positions. */
function caretBlock(blocks: Block[]): string {
  const doc = docOf(blocks);
  const selection = initialCaret(doc);
  return selection.$from.node(1).type.name;
}

const divider: Block = block('Divider', []);
const image: Block = block('Image', [span('')], {
  kind: 'image',
  path: '',
  alt: '',
  width: 0,
  align: 'left',
  crop: null,
});

describe('where the caret goes', () => {
  it('takes the first line of an ordinary note', () => {
    expect(caretBlock([block('Text', [span('hello')])])).toBe('paragraph');
  });

  /**
   * The first block is not always somewhere a caret can be seen. A divider
   * draws nothing at the position its line holds, so a caret parked there is
   * invisible and everything typed into it is dropped on save.
   */
  it('walks past a block that draws no line of its own', () => {
    expect(caretBlock([divider, block('Text', [span('after')])])).toBe('paragraph');
  });

  it('walks past a block equation the same way', () => {
    const equation = block('Equation', [span('')], { kind: 'equation', latex: 'x^2' });
    expect(caretBlock([equation, block('Heading2', [span('after')])])).toBe('heading');
  });

  /**
   * A picture is not one of those. Its line is the caption, which is real text
   * somebody types, so it is a place a caret belongs even while it is empty.
   */
  it('stops at a picture, whose line is its caption', () => {
    expect(caretBlock([image, block('Text', [span('after')])])).toBe('image');
  });

  it('reaches into a container for the first block that can hold it', () => {
    const columns = block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
      children: [
        block('ColumnGroup', [span('')], { kind: 'empty' }, {
          children: [block('Text', [span('left')])],
        }),
        block('ColumnGroup', [span('')], { kind: 'empty' }, {
          children: [block('Text', [span('right')])],
        }),
      ],
    });
    const doc = docOf([columns]);
    const selection = initialCaret(doc);
    expect(selection.$from.parent.type.name).toBe('line');
    expect(selection.$from.parent.textContent).toBe('');
    expect(selection.empty).toBe(true);
  });

  it('lands at the start of the line, not at the end of its text', () => {
    const doc = docOf([block('Text', [span('hello')])]);
    expect(initialCaret(doc).$from.parentOffset).toBe(0);
  });
});

describe('taking the keyboard with it', () => {
  it('focuses an editable note and puts the caret in it', () => {
    const view = mount([divider, block('Text', [span('after')])]);
    focusNoteOnOpen(view);
    expect(view.hasFocus()).toBe(true);
    expect(view.state.selection.$from.node(1).type.name).toBe('paragraph');
  });

  it('leaves a read-only mount alone, which has no caret to place', () => {
    const view = mount([block('Text', [span('hello')])], false);
    focusNoteOnOpen(view);
    expect(view.hasFocus()).toBe(false);
  });

  /**
   * Filtering the tree is how a note gets opened in the first place, so the
   * search box is holding a half-typed word exactly when this runs.
   */
  it('leaves the keyboard in a field somebody is typing in', () => {
    const search = document.createElement('input');
    search.type = 'search';
    document.body.appendChild(search);
    search.focus();

    const view = mount([block('Text', [span('hello')])]);
    focusNoteOnOpen(view);
    expect(document.activeElement).toBe(search);
    expect(view.hasFocus()).toBe(false);
  });

  it('still takes the keyboard from a button, which is holding no text', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    const view = mount([block('Text', [span('hello')])]);
    focusNoteOnOpen(view);
    expect(view.hasFocus()).toBe(true);
  });

  it('leaves a dialog on screen holding the reader', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.appendChild(dialog);

    const view = mount([block('Text', [span('hello')])]);
    focusNoteOnOpen(view);
    expect(view.hasFocus()).toBe(false);
  });
});
