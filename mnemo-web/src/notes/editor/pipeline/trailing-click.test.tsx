// @vitest-environment jsdom

/**
 * A press below the last block, and the three presses that look like it.
 *
 * jsdom lays nothing out, so the blocks' boxes are stubbed. That is all this
 * needs: the rule is "the press was under everything", and what is being pinned
 * is which presses answer to that and what the document does about it, not where
 * a browser would have put the pixels.
 */

import { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';

type Blocks = Parameters<typeof buildNoteEditState>[0];

/** Every block is one row this tall, laid out top to bottom from y = 0. */
const ROW_H = 40;

let view: EditorView | null = null;
let mount: HTMLElement | null = null;
let restore: (() => void) | null = null;

/**
 * Stacks the top-level blocks so the last one has a bottom edge to be under.
 *
 * `elementFromPoint` is stubbed alongside because a press this rule *declines* is
 * then ProseMirror's, and its own mousedown handler asks the document what is
 * under the pointer. jsdom has no such method, so without this the tests that
 * prove a press is left alone would take the fallback down with them.
 */
function stubLayout(): () => void {
  const from = Object.getOwnPropertyDescriptor(Document.prototype, 'elementFromPoint');
  Object.defineProperty(Document.prototype, 'elementFromPoint', {
    configurable: true,
    value: (): Element | null => null,
  });
  const rect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element): DOMRect {
      const index = Array.prototype.indexOf.call(this.parentElement?.children ?? [], this);
      const top = index < 0 ? 0 : index * ROW_H;
      return { x: 0, y: top, top, bottom: top + ROW_H, left: 0, right: 600, width: 600, height: ROW_H } as DOMRect;
    },
  });
  return () => {
    if (rect) Object.defineProperty(Element.prototype, 'getBoundingClientRect', rect);
    if (from) Object.defineProperty(Document.prototype, 'elementFromPoint', from);
    else Reflect.deleteProperty(Document.prototype, 'elementFromPoint');
  };
}

function open(blocks: Blocks, editable = true): EditorView {
  restore = stubLayout();
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  mount = document.createElement('div');
  document.body.appendChild(mount);
  view = new EditorView(mount, { state: built.state, editable: () => editable });
  return view;
}

/** The bottom edge of the last block, which is what the rule is measured against. */
function documentBottom(): number {
  return view!.state.doc.childCount * ROW_H;
}

function press(clientY: number, options: { target?: Element; button?: number } = {}): boolean {
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientY,
    button: options.button ?? 0,
  });
  (options.target ?? view!.dom).dispatchEvent(event);
  return event.defaultPrevented;
}

/** The text of every top-level block, so an append is read as a block and not a position. */
function blockTexts(): string[] {
  const out: string[] = [];
  view!.state.doc.forEach((node) => out.push(node.textContent));
  return out;
}

afterEach(() => {
  view?.destroy();
  mount?.remove();
  restore?.();
  view = null;
  mount = null;
  restore = null;
});

describe('a press below the last block', () => {
  /**
   * The block types that motivated the rule. Neither can be left with Enter (a
   * table walks its cells, a code block takes a newline), so with one of them at
   * the bottom of a note the space underneath is the only way to add anything
   * after it.
   */
  const table = () =>
    block('Table', [span('')], { kind: 'table', columnWidths: [180], headerRows: [], headerColumns: [], fullWidth: false }, {
      children: [
        block('TableRow', [span('')], { kind: 'empty' }, {
          children: [block('TableCell', [span('cell')], { kind: 'tableCell', fill: '' })],
        }),
      ],
    });

  it('appends a block under a table and puts the caret in it', () => {
    open([block('Text', [span('above')]), table()]);
    expect(press(documentBottom() + 20)).toBe(true);
    expect(blockTexts()).toEqual(['above', 'cell', '']);
    expect(view!.state.doc.lastChild!.type.name).toBe('paragraph');
    // The caret is in what was just made, not left where it was.
    expect(view!.state.selection.$from.parent.type.name).toBe('line');
    expect(view!.state.selection.from).toBe(view!.state.doc.content.size - 2);
  });

  it('appends a block under a code block', () => {
    open([
      block('Code', [span('')], { kind: 'code', language: 'javascript', source: 'let x = 1;' }),
    ]);
    expect(press(documentBottom() + 20)).toBe(true);
    expect(view!.state.doc.childCount).toBe(2);
    expect(view!.state.doc.lastChild!.type.name).toBe('paragraph');
  });

  it('takes the empty block already there rather than stacking another on it', () => {
    open([block('Text', [span('above')]), block('Text', [span('')])]);
    expect(press(documentBottom() + 20)).toBe(true);
    expect(blockTexts()).toEqual(['above', '']);
    expect(view!.state.selection.from).toBe(view!.state.doc.content.size - 2);
  });

  it('leaves a press on a block alone, so the caret still lands where it was aimed', () => {
    open([block('Text', [span('above')]), table()]);
    const before = view!.state.doc.childCount;
    expect(press(documentBottom() + 20, { target: view!.dom.firstElementChild! })).toBe(false);
    expect(view!.state.doc.childCount).toBe(before);
  });

  it('leaves a press in the gap between two blocks alone', () => {
    // The root's own DOM, like the trailing space, but not below everything.
    open([block('Text', [span('above')]), block('Text', [span('below')])]);
    expect(press(ROW_H - 1)).toBe(false);
    expect(view!.state.doc.childCount).toBe(2);
  });

  it('leaves the right button alone, so the context menu still opens', () => {
    open([block('Text', [span('above')])]);
    expect(press(documentBottom() + 20, { button: 2 })).toBe(false);
    expect(view!.state.doc.childCount).toBe(1);
  });

  it('adds nothing to a note being read rather than edited', () => {
    open([block('Text', [span('above')])], false);
    expect(press(documentBottom() + 20)).toBe(false);
    expect(view!.state.doc.childCount).toBe(1);
  });
});
