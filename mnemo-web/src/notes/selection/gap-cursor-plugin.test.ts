// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { buildNoteEditState } from '../edit/build-edit-state';
import { redo, undo } from '../editor/history';
import { block, span } from '../editor/mapper/fixtures';
import { GapCursor } from './gap-cursor';
import { getBlockSelection } from './block-selection-plugin';
import { LEAVE_TOP_EVENT } from './gap-cursor-plugin';

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

const text = (body: string) => block('Text', [span(body)]);
const divider = () => block('Divider', [span('')]);
const equation = (latex = 'E = mc^2') =>
  block('Equation', [span('')], { kind: 'equation', latex });
const cell = (body: string) =>
  block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [text(body)] });
const twoColumn = () =>
  block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
    children: [cell('left'), cell('right')],
  });
const image = (caption: string) =>
  block('Image', [span(caption)], { kind: 'image', path: 'a', alt: '', width: 100, align: 'center', crop: null });
const tableCell = (body: string) => block('TableCell', [span(body)]);
const tableRow = (...cells: ReturnType<typeof tableCell>[]) =>
  block('TableRow', [span('')], { kind: 'empty' }, { children: cells });
const table = () =>
  block('Table', [span('')], {
    kind: 'table',
    columnWidths: [],
    headerRows: [],
    headerColumns: [],
    fullWidth: false,
  }, {
    children: [
      tableRow(tableCell('a'), tableCell('b')),
      tableRow(tableCell('c'), tableCell('d')),
    ],
  });

/** Put the caret at `offset` in the line of the `index`-th top-level block. */
function caret(editor: EditorView, index: number, offset = 0): void {
  let start = -1;
  editor.state.doc.forEach((_node, pos, at) => {
    if (at === index) start = pos;
  });
  editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start + 2 + offset)));
}

/** Put the caret at the end of the `index`-th block's line. */
function caretAtEnd(editor: EditorView, index: number): void {
  caret(editor, index, editor.state.doc.child(index).child(0).content.size);
}

function press(editor: EditorView, key: string): void {
  editor.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** What the plugin does with typed text, which reaches ProseMirror as text input. */
function type(editor: EditorView, body: string): boolean {
  const { from, to } = editor.state.selection;
  return (
    editor.someProp('handleTextInput', (f) =>
      f(editor, from, to, body, () => editor.state.tr.insertText(body, from, to)),
    ) === true
  );
}

function topTypes(editor: EditorView): string[] {
  const names: string[] = [];
  editor.state.doc.forEach((node) => names.push(node.type.name));
  return names;
}

beforeAll(() => {
  // jsdom does no layout, and the vertical arrows ask ProseMirror whether the
  // caret is on the last visual line of its block, which it answers by
  // measuring. Zero-sized boxes read as "yes", which is what a one-line
  // fixture would say anyway.
  const zeroRect = (): DOMRect =>
    ({
      x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  const noRects = (): DOMRectList => [] as unknown as DOMRectList;
  Range.prototype.getClientRects = noRects;
  Range.prototype.getBoundingClientRect = zeroRect;
  Element.prototype.getClientRects = noRects;
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    // no layout to scroll
  };
});

afterEach(() => {
  view?.destroy();
  mount?.remove();
  view = null;
  mount = null;
});

describe('reaching the boundary above a note that starts with an equation', () => {
  it('ArrowUp from the block below lands on a gap cursor', () => {
    const editor = open([equation(), text('below')]);
    caret(editor, 1);
    press(editor, 'ArrowUp');
    expect(editor.state.selection).toBeInstanceOf(GapCursor);
    expect(editor.state.selection.head).toBe(0);
  });

  it('draws the caret, since nothing in the document sits where it points', () => {
    const editor = open([equation(), text('below')]);
    caret(editor, 1);
    expect(editor.dom.querySelector('.notes-gap-caret')).toBeNull();
    press(editor, 'ArrowUp');
    expect(editor.dom.querySelector('.notes-gap-caret')).not.toBeNull();
  });

  it('typing there makes the paragraph the gap stood for', () => {
    const editor = open([equation(), text('below')]);
    caret(editor, 1);
    press(editor, 'ArrowUp');
    expect(type(editor, 'above')).toBe(true);
    expect(topTypes(editor)).toEqual(['paragraph', 'equationBlock', 'paragraph']);
    expect(editor.state.doc.child(0).textContent).toBe('above');
    expect(editor.state.selection.from).toBe(2 + 'above'.length);
  });

  it('answers a typed character in beforeinput, before the engine edits the DOM', () => {
    // The gap's DOM selection sits between two block elements. Left to the
    // engine, the typed text lands there and is read back as a change that
    // spans the block after it, which the parser folds into the new paragraph.
    const editor = open([equation(), text('below')]);
    caret(editor, 1);
    press(editor, 'ArrowUp');
    const event = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'A',
      bubbles: true,
      cancelable: true,
    });
    editor.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(topTypes(editor)).toEqual(['paragraph', 'equationBlock', 'paragraph']);
    expect(editor.state.doc.child(0).textContent).toBe('A');
    expect(editor.state.doc.child(1).type.name).toBe('equationBlock');
  });

  it('Enter there makes an empty one', () => {
    const editor = open([equation(), text('below')]);
    caret(editor, 1);
    press(editor, 'ArrowUp');
    press(editor, 'Enter');
    expect(topTypes(editor)).toEqual(['paragraph', 'equationBlock', 'paragraph']);
    expect(editor.state.doc.child(0).textContent).toBe('');
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
  });

  it('ArrowDown out of the gap returns to the line below the equation', () => {
    const editor = open([equation(), text('below')]);
    caret(editor, 1);
    press(editor, 'ArrowUp');
    press(editor, 'ArrowDown');
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection.$from.parent.textContent).toBe('below');
    expect(editor.state.doc.childCount).toBe(2);
  });

  it('ArrowUp at the gap stays there rather than jumping into the equation', () => {
    const editor = open([equation(), text('below')]);
    caret(editor, 1);
    press(editor, 'ArrowUp');
    press(editor, 'ArrowUp');
    expect(editor.state.selection).toBeInstanceOf(GapCursor);
    expect(editor.state.selection.head).toBe(0);
  });

  it('a click at the boundary places the gap cursor', () => {
    const editor = open([divider(), text('below')]);
    const handled = editor.someProp('handleClick', (f) =>
      f(editor, 0, new MouseEvent('mousedown')),
    );
    expect(handled).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(GapCursor);
  });
});

describe('reaching the boundary below a note that ends with a divider', () => {
  it('ArrowDown from the block above lands on a gap cursor', () => {
    const editor = open([text('above'), divider()]);
    caretAtEnd(editor, 0);
    press(editor, 'ArrowDown');
    expect(editor.state.selection).toBeInstanceOf(GapCursor);
    expect(editor.state.selection.head).toBe(editor.state.doc.content.size);
  });

  it('typing there appends a paragraph after the divider', () => {
    const editor = open([text('above'), divider()]);
    caretAtEnd(editor, 0);
    press(editor, 'ArrowDown');
    expect(type(editor, 'after')).toBe(true);
    expect(topTypes(editor)).toEqual(['paragraph', 'divider', 'paragraph']);
    expect(editor.state.doc.child(2).textContent).toBe('after');
  });
});

describe('walking a run of blocks that hold no caret', () => {
  it('takes one gap at a time', () => {
    const editor = open([divider(), equation(), text('below')]);
    caret(editor, 2);
    press(editor, 'ArrowUp');
    expect(editor.state.selection.head).toBe(editor.state.doc.child(0).nodeSize);
    press(editor, 'ArrowUp');
    expect(editor.state.selection.head).toBe(0);
    expect(editor.state.selection).toBeInstanceOf(GapCursor);
  });
});

describe('removing a block the caret cannot enter', () => {
  it('Backspace after a divider selects it, and the next press deletes it', () => {
    const editor = open([divider(), text('below')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(getBlockSelection(editor.state).selected.size).toBe(1);
    expect(topTypes(editor)).toEqual(['divider', 'paragraph']);

    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['paragraph']);
  });

  it('Delete before a divider selects it, and the next press deletes it', () => {
    const editor = open([text('above'), divider()]);
    caretAtEnd(editor, 0);
    press(editor, 'Delete');
    expect(getBlockSelection(editor.state).selected.size).toBe(1);
    press(editor, 'Delete');
    expect(topTypes(editor)).toEqual(['paragraph']);
  });

  it('Backspace at a gap selects the block behind it', () => {
    const editor = open([text('above'), equation()]);
    caretAtEnd(editor, 0);
    press(editor, 'ArrowDown');
    expect(editor.state.selection).toBeInstanceOf(GapCursor);
    press(editor, 'Backspace');
    expect(getBlockSelection(editor.state).selected.size).toBe(1);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['paragraph']);
  });

  it('Backspace after a table selects it whole, and the next press deletes it', () => {
    const editor = open([table(), text('below')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    // The grip's own unit: a table is named by the cells inside it.
    expect(getBlockSelection(editor.state).selected.size).toBe(4);
    expect(topTypes(editor)).toEqual(['table', 'paragraph']);

    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['paragraph']);
  });

  it('Backspace after a two-column selects it whole, and the next press deletes it', () => {
    const editor = open([twoColumn(), text('below')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(getBlockSelection(editor.state).selected.size).toBe(2);

    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['paragraph']);
  });

  it('leaves an ordinary merge alone', () => {
    const editor = open([text('one'), text('two')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(getBlockSelection(editor.state).selected.size).toBe(0);
    expect(topTypes(editor)).toEqual(['paragraph']);
    expect(editor.state.doc.child(0).textContent).toBe('onetwo');
  });

  it('lets a heading de-format first, and marks the divider on the press after', () => {
    const editor = open([divider(), block('Heading2', [span('title')])]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(getBlockSelection(editor.state).selected.size).toBe(0);
    expect(topTypes(editor)).toEqual(['divider', 'paragraph']);

    press(editor, 'Backspace');
    expect(getBlockSelection(editor.state).selected.size).toBe(1);
  });

  it('leaves Delete before a heading swallowed, as it was', () => {
    const editor = open([text('above'), block('Heading2', [span('title')])]);
    caretAtEnd(editor, 0);
    press(editor, 'Delete');
    expect(getBlockSelection(editor.state).selected.size).toBe(0);
    expect(topTypes(editor)).toEqual(['paragraph', 'heading']);
  });
});

describe('Backspace on an empty line below a block the caret cannot enter', () => {
  const lineless: [string, () => ReturnType<typeof block>][] = [
    ['an equation', () => equation()],
    ['a divider', () => divider()],
    ['a table', () => table()],
    ['a two-column', () => twoColumn()],
  ];

  it.each(lineless)('removes only the empty line below %s', (_name, make) => {
    const editor = open([make(), text('')]);
    const before = topTypes(editor);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(before.slice(0, 1));
    expect(getBlockSelection(editor.state).selected.size).toBe(0);
  });

  it('sends the caret to the title when nothing is above the widget', () => {
    const editor = open([equation(), text(''), text('after')]);
    let leftTop = 0;
    editor.dom.addEventListener(LEAVE_TOP_EVENT, () => leftTop++);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['equationBlock', 'paragraph']);
    expect(leftTop).toBe(1);
  });

  it('puts the caret at the end of the line above the widget', () => {
    const editor = open([text('above'), equation(), text(''), text('after')]);
    caret(editor, 2);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['paragraph', 'equationBlock', 'paragraph']);
    const { $head } = editor.state.selection;
    expect($head.parent.textContent).toBe('above');
    expect($head.parentOffset).toBe(5);
  });

  it('steps over several widgets and images going up', () => {
    const editor = open([text('above'), image('cap'), divider(), equation(), text('')]);
    caret(editor, 4);
    press(editor, 'Backspace');
    expect(editor.state.doc.childCount).toBe(4);
    const { $head } = editor.state.selection;
    expect($head.parent.textContent).toBe('above');
    expect($head.parentOffset).toBe(5);
  });

  it('removes the line below an image and skips its caption', () => {
    const editor = open([text('above'), image('cap'), text('')]);
    caret(editor, 2);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['paragraph', 'image']);
    expect(editor.state.selection.$head.parent.textContent).toBe('above');
  });

  it('sends the caret to the title from below an image at the top', () => {
    const editor = open([image('cap'), text('')]);
    let leftTop = 0;
    editor.dom.addEventListener(LEAVE_TOP_EVENT, () => leftTop++);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['image']);
    expect(leftTop).toBe(1);
  });

  it('puts the caret at the end of a table above when nothing follows', () => {
    const editor = open([table(), text('')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    const { $head } = editor.state.selection;
    expect($head.parent.textContent).toBe('d');
    expect($head.parentOffset).toBe(1);
  });

  it('puts the caret at the end of the last column above', () => {
    const editor = open([twoColumn(), text(''), text('after')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toHaveLength(2);
    const { $head } = editor.state.selection;
    expect($head.parent.textContent).toBe('right');
    expect($head.parentOffset).toBe(5);
  });

  it('puts the caret at the end of the line above a nested equation when nothing follows', () => {
    const list = block('BulletList', [span('p')], { kind: 'empty' }, { children: [equation()] });
    const editor = open([list, text('')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(editor.state.doc.childCount).toBe(1);
    const { $head } = editor.state.selection;
    expect($head.parent.textContent).toBe('p');
    expect($head.parentOffset).toBe(1);
  });

  it('keeps the widget on the press after, which edits the line above', () => {
    const editor = open([text('above'), equation(), text('')]);
    caret(editor, 2);
    press(editor, 'Backspace');
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['paragraph', 'equationBlock']);
    expect(getBlockSelection(editor.state).selected.size).toBe(0);
  });

  it('undoes and redoes the removal as one step', () => {
    const editor = open([equation(), text('')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    undo(editor.state, editor.dispatch);
    expect(topTypes(editor)).toEqual(['equationBlock', 'paragraph']);
    redo(editor.state, editor.dispatch);
    expect(topTypes(editor)).toEqual(['equationBlock']);
    undo(editor.state, editor.dispatch);
    expect(topTypes(editor)).toEqual(['equationBlock', 'paragraph']);
  });

  it('dissolves an empty line that holds a nested list into its children', () => {
    const child = block('BulletList', [span('kid')]);
    const editor = open([equation(), block('Text', [span('')], { kind: 'empty' }, { children: [child] })]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['equationBlock', 'bulletItem']);
    expect(editor.state.doc.child(1).textContent).toBe('kid');
  });

  it('still marks the widget from a line with text', () => {
    const editor = open([equation(), text('x')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['equationBlock', 'paragraph']);
    expect(getBlockSelection(editor.state).selected.size).toBe(1);
  });

  it('removes the line when it sits below a block whose line takes a caret', () => {
    const kinds = [
      block('Code', [span('x')], { kind: 'code', language: 'text', source: 'x' }),
      block('Callout', [span('x')], { kind: 'callout', emoji: '', tone: 'note' }),
      block('Quote', [span('x')]),
      block('BulletList', [span('x')]),
    ];
    for (const kind of kinds) {
      const editor = open([kind, text('')]);
      caret(editor, 1);
      press(editor, 'Backspace');
      expect(editor.state.doc.childCount).toBe(1);
      expect(editor.state.selection.$head.parent.type.name).toMatch(/line|codeLine/);
      expect(editor.state.selection.empty).toBe(true);
      view?.destroy();
      mount?.remove();
    }
  });

  it('removes the line below a nested list', () => {
    const list = block('BulletList', [span('p')], { kind: 'empty' }, {
      children: [block('BulletList', [span('c')])],
    });
    const editor = open([list, text('')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.selection.$head.parent.textContent).toBe('c');
  });

  it('keeps the only line of a note', () => {
    const editor = open([text('')]);
    caret(editor, 0);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['paragraph']);
  });

  it('removes an empty first line in front of a widget without touching it', () => {
    const editor = open([text(''), equation()]);
    caret(editor, 0);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['equationBlock']);
  });

  it('does nothing for an empty first line in a column cell', () => {
    const left = block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [text(''), text('keep')] });
    const right = cell('right');
    const split = block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
      children: [left, right],
    });
    const editor = open([split]);
    const doc = editor.state.doc;
    let first = -1;
    doc.descendants((node, pos) => {
      if (first < 0 && node.type.name === 'paragraph') first = pos;
    });
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, first + 2)));
    const shape = (view: EditorView) => view.state.doc.textBetween(0, view.state.doc.content.size, '|');
    const before = shape(editor);
    press(editor, 'Backspace');
    const { $head } = editor.state.selection;
    expect(shape(editor)).toBe(before);
    expect($head.parentOffset).toBe(0);
  });

  it('keeps a line of spaces and marks the widget instead', () => {
    const editor = open([equation(), text('   ')]);
    caret(editor, 1);
    press(editor, 'Backspace');
    expect(topTypes(editor)).toEqual(['equationBlock', 'paragraph']);
    expect(editor.state.doc.child(1).textContent).toBe('   ');
    expect(getBlockSelection(editor.state).selected.size).toBe(1);
  });
});
