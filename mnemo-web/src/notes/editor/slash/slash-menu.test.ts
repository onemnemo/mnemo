// @vitest-environment jsdom

/**
 * The slash menu plugin, driven through a real mounted `EditorView` so the
 * trigger is read out of an actual document and a pick runs the registry's own
 * insert against it. Placement is not asserted here: jsdom measures everything
 * as zero, so that is `floating/position.test.ts`'s job.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { block, span, styled } from '../mapper/fixtures';
import type { Block } from '../../model/types';
import { editorHistory } from '../history';
import { undo } from '../history';
import { slashMenuPlugin } from './slash-menu';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

/**
 * Stands in for the bundle by splitting a key into words, so `Heading3` reads
 * "Heading 3" the way the shipped string does. Matching runs against the
 * resolved label, so a key jammed into one word would make queries like
 * "heading 3" miss for a reason the shipped app does not have. Rows are still
 * asserted by their key, through `data-label`, so a translation edit cannot
 * break a test about behaviour.
 */
function translate(key: string): string {
  return key.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

beforeAll(() => {
  // jsdom does no layout and ships neither of these; PM's mousedown path asks
  // the document what is under the pointer, and the menu scrolls its current
  // row into view. Both are absent rather than broken.
  (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    // no layout to scroll
  };
});

afterEach(() => {
  document.body.replaceChildren();
});

function mount(blocks: Block[]): EditorView {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const state = EditorState.create({
    doc: result.doc,
    schema,
    plugins: [editorHistory(), slashMenuPlugin(registry, { translate })],
  });
  return new EditorView(container, { state });
}

function menuEl(): HTMLElement {
  const el = document.querySelector('.notes-slash-menu');
  if (!el) throw new Error('menu not in the document');
  return el as HTMLElement;
}

function isOpen(): boolean {
  return !menuEl().hasAttribute('data-hidden');
}

function rows(): HTMLElement[] {
  return [...menuEl().querySelectorAll<HTMLElement>('.notes-slash-menu-row')];
}

function rowLabels(): string[] {
  return rows().map((row) => row.dataset.label ?? '');
}

function selectedLabel(): string | undefined {
  return menuEl().querySelector<HTMLElement>('.notes-slash-menu-row.is-selected')?.dataset.label;
}

/** Types `text` at the caret, the way the trigger is really produced. */
function type(view: EditorView, text: string): void {
  view.dispatch(view.state.tr.insertText(text));
}

function press(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return view.someProp('handleKeyDown', (f) => f(view, event)) === true;
}

/** Caret at the first offset inside the first block's line. */
function caretAtStart(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
}

function firstBlock(view: EditorView): PMNode {
  return view.state.doc.child(0);
}

function lineText(node: PMNode): string {
  const line = node.firstChild;
  return line ? line.textBetween(0, line.content.size) : '';
}

describe('when the menu opens', () => {
  it('stays closed on an ordinary line', () => {
    const view = mount([block('Text', [span('hello')])]);
    caretAtStart(view);
    expect(isOpen()).toBe(false);
  });

  it('opens once the line starts with a slash', () => {
    const view = mount([block('Text', [span('')])]);
    caretAtStart(view);
    type(view, '/');
    expect(isOpen()).toBe(true);
  });

  it('closes again when the slash is removed', () => {
    const view = mount([block('Text', [span('')])]);
    caretAtStart(view);
    type(view, '/');
    view.dispatch(view.state.tr.delete(2, 3));
    expect(isOpen()).toBe(false);
  });

  it('stays closed when the slash is not the first character', () => {
    const view = mount([block('Text', [span('and')])]);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)));
    type(view, '/');
    expect(isOpen()).toBe(false);
  });

  it('stays closed inside a code block, where a slash is ordinary source', () => {
    const view = mount([block('Code', [span('')], { kind: 'code', language: 'text', source: '' })]);
    caretAtStart(view);
    type(view, '/');
    expect(isOpen()).toBe(false);
  });

  it('stays closed while a range is selected', () => {
    const view = mount([block('Text', [span('/x')])]);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)));
    expect(isOpen()).toBe(false);
  });

  /**
   * Picking a row clears the line. An inline atom holds a position but no
   * text, so nothing in the query would have hinted it was about to go.
   */
  it('stays closed on a line holding an inline equation', () => {
    const view = mount([
      block('Text', [span('/'), { kind: 'equation', latex: 'x^2', style: styled({}) }]),
    ]);
    caretAtStart(view);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    expect(isOpen()).toBe(false);
  });
});

describe('the rows', () => {
  function openMenu(query = ''): EditorView {
    const view = mount([block('Text', [span('')])]);
    caretAtStart(view);
    type(view, `/${query}`);
    return view;
  }

  it('reads in the desktop order, text blocks then inserts', () => {
    openMenu();
    expect(rowLabels()).toEqual([
      'Text',
      'Heading1',
      'Heading2',
      'Heading3',
      'Heading4',
      'BulletList',
      'NumberedList',
      'Todo',
      'Quote',
      'Code',
      'Divider',
      'Equation',
    ]);
  });

  it('rules off where the group changes, and nowhere else', () => {
    openMenu();
    const separated = rows()
      .filter((row) => row.classList.contains('has-separator'))
      .map((row) => row.dataset.label);
    expect(separated).toEqual(['Code']);
  });

  it('filters to what the query matches', () => {
    openMenu('quo');
    expect(rowLabels()).toEqual(['Quote']);
  });

  it('says so rather than showing an empty box when nothing matches', () => {
    openMenu('zzz');
    expect(rowLabels()).toEqual([]);
    const empty = menuEl().querySelector('.notes-slash-menu-empty');
    expect(empty?.hasAttribute('data-hidden')).toBe(false);
  });

  it('shows the markdown shortcut that does the same thing', () => {
    openMenu('quo');
    // `>`, not the `"` the desktop advertises and has never accepted.
    expect(rows()[0].querySelector('.notes-slash-menu-row-hint')?.textContent).toBe('>');
  });
});

describe('keyboard', () => {
  function openMenu(query = ''): EditorView {
    const view = mount([block('Text', [span('')])]);
    caretAtStart(view);
    type(view, `/${query}`);
    return view;
  }

  it('starts on the first row', () => {
    openMenu();
    expect(selectedLabel()).toBe('Text');
  });

  it('walks down and back up', () => {
    const view = openMenu();
    press(view, 'ArrowDown');
    press(view, 'ArrowDown');
    expect(selectedLabel()).toBe('Heading2');
    press(view, 'ArrowUp');
    expect(selectedLabel()).toBe('Heading1');
  });

  it('clamps at both ends rather than wrapping', () => {
    const view = openMenu();
    press(view, 'ArrowUp');
    expect(selectedLabel()).toBe('Text');
    for (let i = 0; i < 30; i++) press(view, 'ArrowDown');
    expect(selectedLabel()).toBe('Equation');
  });

  it('Home and End reach the ends in one press', () => {
    const view = openMenu();
    press(view, 'End');
    expect(selectedLabel()).toBe('Equation');
    press(view, 'Home');
    expect(selectedLabel()).toBe('Text');
  });

  it('goes back to the first row when the query changes', () => {
    const view = openMenu();
    press(view, 'ArrowDown');
    expect(selectedLabel()).toBe('Heading1');
    type(view, 'h');
    expect(selectedLabel()).toBe(rowLabels()[0]);
  });

  it('Escape closes and leaves the typed text to be edited', () => {
    const view = openMenu('quo');
    expect(press(view, 'Escape')).toBe(true);
    expect(isOpen()).toBe(false);
    expect(lineText(firstBlock(view))).toBe('/quo');
  });

  it('hands every key back when the menu is closed', () => {
    const view = mount([block('Text', [span('hi')])]);
    caretAtStart(view);
    expect(press(view, 'ArrowDown')).toBe(false);
    expect(press(view, 'Enter')).toBe(false);
    expect(press(view, 'Escape')).toBe(false);
  });

  it('still swallows Enter with no rows, so it cannot split the block underneath', () => {
    const view = openMenu('zzz');
    expect(press(view, 'Enter')).toBe(true);
    expect(view.state.doc.childCount).toBe(1);
  });
});

describe('picking a row', () => {
  function openMenu(query: string, blocks?: Block[]): EditorView {
    const view = mount(blocks ?? [block('Text', [span('')])]);
    caretAtStart(view);
    type(view, `/${query}`);
    return view;
  }

  it('converts the block and takes the typed query with it', () => {
    const view = openMenu('quo');
    press(view, 'Enter');
    expect(firstBlock(view).type.name).toBe('quote');
    expect(lineText(firstBlock(view))).toBe('');
  });

  it('closes on the way', () => {
    const view = openMenu('quo');
    press(view, 'Enter');
    expect(isOpen()).toBe(false);
  });

  it('leaves the caret in the converted block', () => {
    const view = openMenu('quo');
    press(view, 'Enter');
    expect(view.state.selection.empty).toBe(true);
    expect(view.state.selection.$from.parent.type.name).toBe('line');
  });

  it('reaches the heading level the row names, not just the heading type', () => {
    const view = openMenu('heading 3');
    press(view, 'Enter');
    expect(firstBlock(view).type.name).toBe('heading');
    expect(firstBlock(view).attrs.level).toBe(3);
  });

  /**
   * A sid is the name the AI has already been given and quotes back. A
   * conversion is the same block changing shape, so it has to keep it.
   */
  it('keeps the block identity across the conversion', () => {
    const original = block('Text', [span('')], { kind: 'empty' }, { sid: 'abc12', order: 7 });
    const view = openMenu('quo', [original]);
    press(view, 'Enter');
    const converted = firstBlock(view);
    expect(converted.attrs.sid).toBe('abc12');
    expect(converted.attrs.id).toBe(original.id);
    expect(converted.attrs.order).toBe(7);
  });

  it('is one undo step, taking the type back and leaving the query', () => {
    const view = openMenu('quo');
    press(view, 'Enter');
    undo(view.state, view.dispatch);
    expect(firstBlock(view).type.name).toBe('paragraph');
    expect(lineText(firstBlock(view))).toBe('/quo');
  });

  it('a mouse press on a row picks that row, not the highlighted one', () => {
    const view = openMenu('');
    const quote = rows().find((row) => row.dataset.label === 'Quote');
    quote?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(firstBlock(view).type.name).toBe('quote');
  });
});

/**
 * The rows whose block draws itself from its payload and has no line to type
 * in. Picking one has to leave the caret somewhere real, because the position
 * inside such a block's line renders no DOM at all.
 */
describe('picking a row for a block with nowhere to type', () => {
  function pick(label: string, blocks?: Block[]): EditorView {
    const view = mount(blocks ?? [block('Text', [span('')])]);
    caretAtStart(view);
    type(view, `/${label}`);
    press(view, 'Enter');
    return view;
  }

  function blockAt(view: EditorView, index: number): PMNode {
    return view.state.doc.child(index);
  }

  it('converts the block the caret was in', () => {
    const view = pick('equation');
    expect(firstBlock(view).type.name).toBe('equationBlock');
    expect(firstBlock(view).attrs.latex).toBe('');
  });

  it('keeps the block identity, the same as every other row', () => {
    const original = block('Text', [span('')], { kind: 'empty' }, { sid: 'abc12', order: 7 });
    const view = pick('equation', [original]);
    expect(firstBlock(view).attrs.sid).toBe('abc12');
    expect(firstBlock(view).attrs.order).toBe(7);
  });

  it('puts a block below to carry on typing in', () => {
    const view = pick('equation');
    expect(view.state.doc.childCount).toBe(2);
    expect(blockAt(view, 1).type.name).toBe('paragraph');
  });

  it('leaves the caret in that block rather than in the converted one', () => {
    const view = pick('equation');
    const { $from } = view.state.selection;
    expect($from.node($from.depth - 1).type.name).toBe('paragraph');
  });

  it('uses the block already below instead of adding a second one', () => {
    const view = pick('equation', [block('Text', [span('')]), block('Text', [span('after')])]);
    expect(view.state.doc.childCount).toBe(2);
    expect(lineText(blockAt(view, 1))).toBe('after');
  });

  it('still adds one when the block below cannot hold a caret either', () => {
    const view = pick('equation', [block('Text', [span('')]), block('Divider', [span('')])]);
    expect(view.state.doc.childCount).toBe(3);
    expect(blockAt(view, 1).type.name).toBe('paragraph');
    expect(blockAt(view, 2).type.name).toBe('divider');
  });

  it('does the same for the divider row, which has the same problem', () => {
    const view = pick('divider');
    expect(firstBlock(view).type.name).toBe('divider');
    expect(blockAt(view, 1).type.name).toBe('paragraph');
  });

  it('is one undo step, taking the new block back with the conversion', () => {
    const view = pick('equation');
    undo(view.state, view.dispatch);
    expect(view.state.doc.childCount).toBe(1);
    expect(firstBlock(view).type.name).toBe('paragraph');
    expect(lineText(firstBlock(view))).toBe('/equation');
  });
});

/**
 * DOM focus never leaves the editor while the menu is up, which is what lets
 * the query go on being typed. That makes the editor the only element a screen
 * reader is watching, so it is the editor that has to point at the list and at
 * the row the arrows are on.
 */
describe('what the menu tells a screen reader', () => {
  function openMenu(query = ''): EditorView {
    const view = mount([block('Text', [span('')])]);
    caretAtStart(view);
    type(view, `/${query}`);
    return view;
  }

  function listEl(): HTMLElement {
    const el = menuEl().querySelector('.notes-slash-menu-list');
    if (!el) throw new Error('list not in the document');
    return el as HTMLElement;
  }

  function activeRow(view: EditorView): HTMLElement | null {
    const id = view.dom.getAttribute('aria-activedescendant');
    return id ? document.getElementById(id) : null;
  }

  it('the list names itself', () => {
    openMenu();
    expect(listEl().getAttribute('role')).toBe('listbox');
    // The fixture's translate splits a key into words, as the real bundle does.
    expect(listEl().getAttribute('aria-label')).toBe('Slash Menu Label');
  });

  it('the editor points at the open list', () => {
    const view = openMenu();
    expect(view.dom.getAttribute('aria-expanded')).toBe('true');
    expect(view.dom.getAttribute('aria-controls')).toBe(listEl().id);
  });

  it('the active descendant is the highlighted row, and follows the arrows', () => {
    const view = openMenu();
    expect(activeRow(view)?.dataset.label).toBe('Text');
    press(view, 'ArrowDown');
    expect(activeRow(view)?.dataset.label).toBe('Heading1');
    press(view, 'End');
    expect(activeRow(view)?.dataset.label).toBe('Equation');
  });

  it('follows a filter down to the row it leaves standing', () => {
    const view = openMenu('quo');
    expect(activeRow(view)?.dataset.label).toBe('Quote');
  });

  /** Pointing at a row that does not exist is worse than pointing at nothing. */
  it('points at no row when the query matches none', () => {
    const view = openMenu('zzz');
    expect(view.dom.hasAttribute('aria-activedescendant')).toBe(false);
    expect(view.dom.getAttribute('aria-expanded')).toBe('true');
  });

  it('lets go of all of it when the menu closes', () => {
    const view = openMenu('quo');
    press(view, 'Escape');
    expect(view.dom.hasAttribute('aria-expanded')).toBe(false);
    expect(view.dom.hasAttribute('aria-controls')).toBe(false);
    expect(view.dom.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('lets go of it after a pick too', () => {
    const view = openMenu('quo');
    press(view, 'Enter');
    expect(view.dom.hasAttribute('aria-expanded')).toBe(false);
    expect(view.dom.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('every row has its own id, so the pointer is never ambiguous', () => {
    openMenu();
    const ids = rows().map((row) => row.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('teardown', () => {
  it('destroy takes the menu out of the document', () => {
    const view = mount([block('Text', [span('')])]);
    view.destroy();
    expect(document.querySelector('.notes-slash-menu')).toBeNull();
  });

  /** The editor outlives its menu on a remount; it must not be left pointing
   * at a list that is no longer in the document. */
  it('destroy leaves nothing pointing at the menu', () => {
    const view = mount([block('Text', [span('')])]);
    caretAtStart(view);
    type(view, '/');
    const { dom } = view;
    view.destroy();
    expect(dom.hasAttribute('aria-controls')).toBe(false);
    expect(dom.hasAttribute('aria-activedescendant')).toBe(false);
  });
});
