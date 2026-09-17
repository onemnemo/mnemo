// @vitest-environment jsdom

/**
 * The symbol palette under the full editing plugin stack, typed into a real
 * mounted view one character at a time so the input triggers, the script
 * shortcuts and the slash menu all see the same keystrokes a user's would.
 * Placement is not asserted: jsdom measures everything as zero, and that is
 * `floating/position.test.ts`'s job.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span, styled } from '../mapper/fixtures';
import type { Block } from '../../model/types';
import { redo, undo } from '../history';
import { readRecentSymbols } from './recent';

const FRACTION_SLASH = String.fromCharCode(0x2044);

const views: EditorView[] = [];

beforeAll(() => {
  // jsdom does no layout and ships neither of these; PM's mousedown path asks
  // the document what is under the pointer, and the menu scrolls its current
  // row into view. Both are absent rather than broken.
  (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    // no layout to scroll
  };
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.replaceChildren();
});

function mount(blocks: Block[] = [block('Text', [span('')])]): EditorView {
  const result = buildNoteEditState(blocks);
  if (!result.ok) throw new Error(result.reason.message);
  const state = result.state.apply(result.state.tr.setSelection(Selection.atEnd(result.state.doc)));
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = new EditorView(root, { state });
  views.push(view);
  return view;
}

/** Types `text` one character at a time, the way the triggers really see it. */
function type(view: EditorView, text: string): void {
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

function press(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) === true;
}

function backspace(view: EditorView): void {
  const { from } = view.state.selection;
  view.dispatch(view.state.tr.delete(from - 1, from));
}

/** The palettes on the page: the slash menu's root and the symbol palette's share a class. */
function menus(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.notes-slash-menu')];
}

function openMenu(): HTMLElement | null {
  return menus().find((menu) => !menu.hasAttribute('data-hidden')) ?? null;
}

function rowKeys(): string[] {
  const menu = openMenu();
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLElement>('.notes-slash-menu-row')].map((row) => row.dataset.row ?? '');
}

function groupHeadings(): string[] {
  const menu = openMenu();
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLElement>('.notes-slash-menu-group')].map((el) => el.textContent ?? '');
}

function selectedKey(): string | undefined {
  return openMenu()?.querySelector<HTMLElement>('.notes-slash-menu-row.is-selected')?.dataset.row;
}

function lineText(view: EditorView): string {
  return view.state.doc.child(0).textContent;
}

describe('when the palette opens', () => {
  it('opens on a backslash at the start of a line', () => {
    const view = mount();
    type(view, '\\');
    expect(openMenu()).not.toBeNull();
    expect(groupHeadings()[0]).toBe('SymbolGroupGreek');
  });

  it('opens on a backslash after a space or an opening bracket', () => {
    const view = mount([block('Text', [span('x = (')])]);
    type(view, '\\');
    expect(openMenu()).not.toBeNull();
    press(view, 'Escape');
    type(view, ' ');
    type(view, '\\');
    expect(openMenu()).not.toBeNull();
  });

  it('stays closed after a letter, so a path is never a palette', () => {
    const view = mount([block('Text', [span('C:')])]);
    type(view, '\\Users');
    expect(openMenu()).toBeNull();
    expect(lineText(view)).toBe('C:\\Users');
  });

  it('stays closed in a code block', () => {
    const view = mount([block('Code', [span('')], { kind: 'code', language: 'text', source: '' })]);
    type(view, '\\n');
    expect(openMenu()).toBeNull();
  });

  it('stays closed while an input method is composing', () => {
    const view = mount();
    Object.defineProperty(view, 'composing', { value: true, configurable: true });
    type(view, '\\');
    expect(openMenu()).toBeNull();
  });

  it('opens after an inline equation on the same line', () => {
    const view = mount([
      block('Text', [span(''), { kind: 'equation', latex: 'x^2', style: styled({}) }, span('')]),
    ]);
    type(view, '\\');
    expect(openMenu()).not.toBeNull();
  });
});

describe('the query', () => {
  it('narrows the list to the names that match, best first', () => {
    const view = mount();
    type(view, '\\alp');
    expect(rowKeys()[0]).toBe('alpha');
    expect(selectedKey()).toBe('alpha');
  });

  it('hides the list on a name nothing matches, and Enter is the editor\'s again', () => {
    const view = mount();
    type(view, '\\alpx');
    expect(openMenu()).toBeNull();
    press(view, 'Enter');
    // The structural keymap split the block; nothing was picked.
    expect(view.state.doc.childCount).toBe(2);
    expect(lineText(view)).toBe('\\alpx');
  });

  it('brings the list back when the typo is fixed', () => {
    const view = mount();
    type(view, '\\alpx');
    expect(openMenu()).toBeNull();
    backspace(view);
    expect(rowKeys()[0]).toBe('alpha');
  });

  it('closes on a space, leaving the text as typed', () => {
    const view = mount();
    type(view, '\\frac ');
    expect(openMenu()).toBeNull();
    expect(lineText(view)).toBe('\\frac ');
    type(view, 'x');
    expect(openMenu()).toBeNull();
  });

  it('closes when the backslash is removed', () => {
    const view = mount();
    type(view, '\\');
    backspace(view);
    expect(openMenu()).toBeNull();
  });

  it('Escape closes it for good and leaves the text', () => {
    const view = mount();
    type(view, '\\alp');
    expect(press(view, 'Escape')).toBe(true);
    expect(openMenu()).toBeNull();
    expect(lineText(view)).toBe('\\alp');
    type(view, 'ha');
    expect(openMenu()).toBeNull();
    press(view, 'Enter');
    expect(view.state.doc.childCount).toBe(2);
    expect(lineText(view)).toBe('\\alpha');
  });

  it('hands Escape on when it is closed', () => {
    const view = mount();
    type(view, 'plain');
    expect(press(view, 'Escape')).toBe(false);
  });
});

describe('a pick', () => {
  it('replaces exactly the token with the character', () => {
    const view = mount([block('Text', [span('angle ')])]);
    type(view, '\\alpha');
    expect(press(view, 'Enter')).toBe(true);
    expect(lineText(view)).toBe('angle α');
    expect(openMenu()).toBeNull();
    expect(view.state.selection.from).toBe(2 + 'angle α'.length);
  });

  it('is one undo step that gives the typed name back, and the undo does not rearm the palette', () => {
    const view = mount();
    type(view, '\\alpha');
    press(view, 'Enter');
    undo(view.state, view.dispatch);
    expect(lineText(view)).toBe('\\alpha');
    // The name is back as the user's past, not as a query: Enter splits the block, picks nothing.
    expect(openMenu()).toBeNull();
    press(view, 'Enter');
    expect(view.state.doc.childCount).toBe(2);
    expect(lineText(view)).toBe('\\alpha');
  });

  it('does not open for a name pasted whole', () => {
    const view = mount([block('Text', [span('see ')])]);
    const { from } = view.state.selection;
    view.dispatch(view.state.tr.insertText('\\alpha', from, from).setMeta('paste', true).setMeta('uiEvent', 'paste'));
    expect(openMenu()).toBeNull();
    press(view, 'Enter');
    expect(view.state.doc.childCount).toBe(2);
    expect(lineText(view)).toBe('see \\alpha');
  });

  it('does not open for a lone backslash pasted, which is the size of a keystroke', () => {
    const view = mount([block('Text', [span('see ')])]);
    const { from } = view.state.selection;
    view.dispatch(view.state.tr.insertText('\\', from, from).setMeta('paste', true).setMeta('uiEvent', 'paste'));
    expect(openMenu()).toBeNull();
  });

  it('does not reopen on a redo of a backslash the user dismissed', () => {
    const view = mount([block('Text', [span('dir ')])]);
    type(view, '\\');
    expect(openMenu()).not.toBeNull();
    press(view, 'Escape');
    expect(openMenu()).toBeNull();
    undo(view.state, view.dispatch);
    redo(view.state, view.dispatch);
    expect(lineText(view)).toBe('dir \\');
    expect(openMenu()).toBeNull();
  });

  it('does not open inside inline code, where a backslash is content', () => {
    const view = mount([block('Text', [span('ls ', { code: true })])]);
    type(view, '\\n');
    expect(openMenu()).toBeNull();
  });

  it('leaves Enter to the editor on a bare backslash', () => {
    const view = mount([block('Text', [span('dir ')])]);
    type(view, '\\');
    expect(openMenu()).not.toBeNull();
    press(view, 'Enter');
    expect(view.state.doc.childCount).toBe(2);
    expect(lineText(view)).toBe('dir \\');
  });

  it('keeps the marks the name was typed with', () => {
    const view = mount([block('Text', [span('x', { bold: true })])]);
    type(view, ' \\beta');
    press(view, 'Enter');
    const text = view.state.doc.child(0).firstChild!.lastChild!;
    expect(text.text).toContain('β');
    expect(text.marks.some((mark) => mark.type.name === 'strong')).toBe(true);
  });

  it('turns a typed fraction into its glyph', () => {
    const view = mount();
    type(view, '\\1/2');
    press(view, 'Enter');
    expect(lineText(view)).toBe('½');
  });

  it('renders a fraction Unicode has no glyph for', () => {
    const view = mount();
    type(view, '\\5/7');
    expect(rowKeys()[0]).toBe('5/7');
    press(view, 'Enter');
    expect(lineText(view)).toBe(`⁵${FRACTION_SLASH}₇`);
  });

  it('walks the rows with the arrows before picking', () => {
    const view = mount();
    type(view, '\\omega');
    expect(rowKeys().slice(0, 2)).toEqual(['omega', 'Omega']);
    press(view, 'ArrowDown');
    press(view, 'Enter');
    expect(lineText(view)).toBe('Ω');
  });

  it('a mouse press on a row picks that row', () => {
    const view = mount();
    type(view, '\\pi');
    const row = openMenu()?.querySelector<HTMLElement>('[data-row="Pi"]');
    row?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(lineText(view)).toBe('Π');
  });

  it('is remembered, and the next empty query lists it first under Recent', () => {
    const view = mount();
    type(view, '\\alpha');
    press(view, 'Enter');
    expect(readRecentSymbols()).toEqual(['alpha']);
    type(view, ' \\');
    expect(groupHeadings()[0]).toBe('SymbolGroupRecent');
    expect(rowKeys()[0]).toBe('alpha');
    expect(selectedKey()).toBe('alpha');
  });
});

describe('the Symbol slash row', () => {
  it('writes a backslash at the caret and the palette opens on it', () => {
    const view = mount();
    type(view, '/symbol');
    expect(rowKeys()).toEqual(['Symbol']);
    press(view, 'Enter');
    expect(lineText(view)).toBe('\\');
    expect(groupHeadings()[0]).toBe('SymbolGroupGreek');
    type(view, 'pi');
    press(view, 'Enter');
    expect(lineText(view)).toBe('π');
  });

  it('works mid-line, keeping the text before it', () => {
    const view = mount([block('Text', [span('area is ')])]);
    type(view, '/sym');
    press(view, 'Enter');
    expect(lineText(view)).toBe('area is \\');
    expect(openMenu()).not.toBeNull();
    expect(view.state.selection.from).toBe(2 + 'area is \\'.length);
  });

  it('is one undo step back to the slash query', () => {
    const view = mount();
    type(view, '/sym');
    press(view, 'Enter');
    undo(view.state, view.dispatch);
    expect(lineText(view)).toBe('/sym');
  });

  it('is filed under Insert beside the equation row', () => {
    const view = mount();
    type(view, '/');
    const keys = rowKeys();
    expect(keys.indexOf('Symbol')).toBe(keys.indexOf('Equation') + 1);
  });
});

describe('the two palettes together', () => {
  it('only the one whose trigger was typed is open', () => {
    const view = mount();
    type(view, '/');
    expect(rowKeys()).toContain('Text');
    press(view, 'Escape');
    type(view, ' \\');
    expect(rowKeys()).toContain('alpha');
    expect(menus().filter((menu) => !menu.hasAttribute('data-hidden'))).toHaveLength(1);
  });

  it('a typed script shortcut and a symbol pick compose in one line', () => {
    const view = mount();
    type(view, 'x^2 + \\pi');
    press(view, 'Enter');
    expect(view.state.doc.child(0).textContent).toBe('x2 + π');
    let raised = '';
    view.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === 'sup')) raised += node.text ?? '';
      return !node.isText;
    });
    expect(raised).toBe('2');
  });
});
