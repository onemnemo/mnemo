// @vitest-environment jsdom

/**
 * Ctrl+A, both stages, pressed the way the browser presses it.
 *
 * Through a mounted view rather than against the pure decision alone, because the
 * property that matters is that the chord never reaches `baseKeymap`'s own
 * select-all: that one takes the entire document in a single press, and a note
 * one keystroke from being replaced is the thing the two stages exist to prevent.
 */

import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../edit/build-edit-state';
import { block, span } from '../editor/mapper/fixtures';
import { getBlockSelection } from './block-selection-plugin';

type Blocks = Parameters<typeof buildNoteEditState>[0];

let view: EditorView | null = null;
let mount: HTMLElement | null = null;

function open(blocks: Blocks): EditorView {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  mount = document.createElement('div');
  document.body.appendChild(mount);
  view = new EditorView(mount, { state: built.state, editable: () => true });
  return view;
}

/** Ctrl+A as the browser delivers it: on the element holding the caret. */
function pressSelectAll(): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', ctrlKey: true });
  view!.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Puts the caret in the line holding `text`, by name rather than by counted position. */
function caretInto(text: string, offset = 1): void {
  let at = -1;
  view!.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isTextblock && node.textContent === text) at = pos;
    return true;
  });
  if (at < 0) throw new Error(`no line reads "${text}"`);
  view!.dispatch(view!.state.tr.setSelection(TextSelection.create(view!.state.doc, at + offset)));
}

/** The selected text, so a stage is read as what it holds rather than as positions. */
function selectedText(): string {
  const { from, to } = view!.state.selection;
  return view!.state.doc.textBetween(from, to, ' ');
}

afterEach(() => {
  view?.destroy();
  mount?.remove();
  view = null;
  mount = null;
});

describe('Ctrl+A', () => {
  const three = (): Blocks => [
    block('Text', [span('first')]),
    block('Text', [span('second')]),
    block('Text', [span('third')]),
  ];

  it('takes the block the caret is in on the first press', () => {
    open(three());
    caretInto('second', 3);
    expect(pressSelectAll()).toBe(true);
    expect(selectedText()).toBe('second');
    expect(getBlockSelection(view!.state).selected.size).toBe(0);
  });

  it('takes every block on the second press', () => {
    open(three());
    caretInto('second', 3);
    pressSelectAll();
    expect(pressSelectAll()).toBe(true);
    expect(getBlockSelection(view!.state).selected.size).toBe(3);
  });

  it('stays on every block rather than falling back to one', () => {
    // The block selection collapses the text selection to make itself, so a third
    // press reads a bare caret. Without the guard it would read that as "nothing
    // selected yet" and hand back the single block the caret happens to sit in.
    open(three());
    caretInto('second', 3);
    pressSelectAll();
    pressSelectAll();
    pressSelectAll();
    expect(getBlockSelection(view!.state).selected.size).toBe(3);
  });

  it('escalates at once from an empty block, which has nothing to take', () => {
    open([block('Text', [span('written')]), block('Text', [span('')])]);
    caretInto('');
    expect(pressSelectAll()).toBe(true);
    expect(getBlockSelection(view!.state).selected.size).toBe(2);
  });

  /**
   * Code and image captions used to decline the chord so that the default ran,
   * which selected the whole document's text in one press. The stages are the
   * better answer and they are the same answer everywhere, so the exemption went.
   */
  it('takes the source of a code block, not the whole note', () => {
    open([
      block('Text', [span('above')]),
      block('Code', [span('')], { kind: 'code', language: 'javascript', source: 'let x = 1;\nlet y = 2;' }),
    ]);
    caretInto('let x = 1;\nlet y = 2;', 4);
    expect(pressSelectAll()).toBe(true);
    expect(selectedText()).toBe('let x = 1;\nlet y = 2;');
    expect(getBlockSelection(view!.state).selected.size).toBe(0);
    expect(pressSelectAll()).toBe(true);
    expect(getBlockSelection(view!.state).selected.size).toBe(2);
  });

  it('takes one cell of a table, not the table', () => {
    open([
      block('Table', [span('')], { kind: 'table', columnWidths: [180, 180], headerRow: false, headerCol: false, fullWidth: false }, {
        children: [
          block('TableRow', [span('')], { kind: 'empty' }, {
            children: [
              block('TableCell', [span('left cell')], { kind: 'tableCell', fill: '' }),
              block('TableCell', [span('right cell')], { kind: 'tableCell', fill: '' }),
            ],
          }),
        ],
      }),
    ]);
    caretInto('left cell', 3);
    expect(pressSelectAll()).toBe(true);
    expect(selectedText()).toBe('left cell');
  });
});
