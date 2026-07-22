// @vitest-environment jsdom

/**
 * The formatting toolbar plugin. `coordsAtPos`-based positioning is not asserted here:
 * jsdom has no real layout engine, so real pixel output is `position.test.ts`'s
 * job. This covers what a headless `EditorView` can actually prove: the plugin
 * shows/hides with the selection, its buttons run the same commands the
 * catalog describes and agree with the same active/enabled readouts, the
 * swatch popover applies and clears tokens, and teardown leaves nothing behind.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { block, span } from '../mapper/fixtures';
import type { Block } from '../../model/types';
import { EDITOR_COMMANDS, type EditorCommand } from '../commands/catalog';
import { formattingToolbarPlugin } from './formatting-toolbar';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

beforeAll(() => {
  // A mousedown on the editor reaches ProseMirror's own handler, which asks
  // the document what is under the pointer. jsdom does no layout and so ships
  // no `elementFromPoint` at all; null is the "nothing there" answer PM
  // already handles, and the alternative is an unhandled TypeError from a
  // dependency during a test that is not about hit-testing.
  (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
});

// Real timers would make every hide assertion a race against the close
// debounce; `settle()` is how a test says "the selection has now been empty
// long enough", which is the thing being asserted anyway.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function settle(): void {
  vi.advanceTimersByTime(200);
}

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function mount(blocks: Block[], commands?: readonly EditorCommand[]): EditorView {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  const state = EditorState.create({
    doc: result.doc,
    schema,
    // Labels are asserted as keys, not as whatever the shipped bundle says, so
    // a translation edit cannot break a test about behaviour.
    plugins: [formattingToolbarPlugin({ translate: (key) => `t:${key}`, commands })],
  });
  return new EditorView(container(), { state });
}

function textBlock(text: string, extra: Parameters<typeof span>[1] = {}): Block {
  return block('Text', [span(text, extra)]);
}

function codeBlock(text: string): Block {
  return block('Code', [span(text)], { kind: 'code', language: 'text', source: text });
}

/** Bold is held by an invariant here, so the command refuses it. */
function headingBlock(text: string): Block {
  return block('Heading2', [span(text)]);
}

/** Selects every inline node in the doc, walked, not assumed at [0, size]: a
 * document position 0 is not necessarily inside inline content once a block
 * wraps its text in a container, and `TextSelection.create` silently warns
 * and falls back rather than throwing, which masks the mistake instead of
 * catching it. */
function selectAll(view: EditorView): void {
  let from = -1;
  let to = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.isText || node.isAtom) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
    return !node.isText && !node.isAtom;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

function toolbarEl(): HTMLElement {
  const el = document.querySelector('.notes-formatting-toolbar');
  if (!el) throw new Error('toolbar not in the document');
  return el as HTMLElement;
}

function button(commandId: string): HTMLButtonElement {
  const el = toolbarEl().querySelector<HTMLButtonElement>(`button[data-command="${commandId}"]`);
  if (!el) throw new Error(`no button for "${commandId}"`);
  return el;
}

/** Position 2 is the first offset inside the line, the block and line each cost one. */
function collapseCaret(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
}

/** The one gesture PM itself does not report: it keeps its selection when
 * focus leaves, so without this the bubble would hang over the page. */
function pressOutside(): void {
  const outside = document.createElement('div');
  document.body.appendChild(outside);
  outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

function pressInEditor(view: EditorView): void {
  view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

function releasePointer(): void {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

function popoverEl(): HTMLElement {
  const el = toolbarEl().querySelector('.notes-formatting-toolbar-swatch-popover');
  if (!el) throw new Error('popover not found');
  return el as HTMLElement;
}

function colorButton(): HTMLButtonElement {
  return toolbarEl().querySelector('.notes-formatting-toolbar-color') as HTMLButtonElement;
}

/** `row` matters because both rows offer a `none` cell and overlapping tokens. */
function cell(row: 'text' | 'background', token: string): HTMLButtonElement {
  const rows = popoverEl().querySelectorAll('.notes-formatting-toolbar-swatch-row');
  const scope = row === 'text' ? rows[0] : rows[1];
  const el = scope.querySelector<HTMLButtonElement>(`button[data-token="${token}"]`);
  if (!el) throw new Error(`no ${row} swatch cell for "${token}"`);
  return el;
}

/** A chord the editor sees, the route the toolbar's entry key really arrives by. */
function pressInDocument(view: EditorView, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return view.someProp('handleKeyDown', (f) => f(view, event)) === true;
}

/** A press on whatever currently holds focus, which is how the toolbar hears one. */
function pressFocused(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

function focusedCommand(): string | undefined {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return undefined;
  return el.classList.contains('notes-formatting-toolbar-color')
    ? 'color'
    : (el.dataset.command ?? el.dataset.token);
}

function toolbarHasFocus(): boolean {
  return toolbarEl().contains(document.activeElement);
}

describe('show/hide follows the selection', () => {
  it('mounts hidden, the doc opens with a collapsed caret', () => {
    mount([textBlock('hello')]);
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
  });

  it('appears once the selection is a real range', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);
  });

  it('hides again once the selection collapses back to a caret', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    collapseCaret(view);
    settle();
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
  });
});

/**
 * The desktop gives an emptied selection 80ms to come back before closing.
 * A selection reads empty for a frame in the middle of interactions the user
 * experiences as continuous, and closing on the first empty report blinks.
 */
describe('the close debounce', () => {
  it('stays up for a moment after the selection empties', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    collapseCaret(view);
    vi.advanceTimersByTime(40);
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);
  });

  it('a range arriving inside the window cancels the close', () => {
    const view = mount([textBlock('hello world')]);
    selectAll(view);
    collapseCaret(view);
    vi.advanceTimersByTime(40);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 5)));
    settle();
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);
  });

  it('an outside press closes at once rather than waiting it out', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    pressOutside();
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
  });
});

/**
 * Nothing is shown while a selection is still being dragged out. The desktop
 * skips its whole check while `IsPointerSelecting`; here the press hides the
 * bubble outright, so it cannot sit over the text the pointer is crossing.
 */
describe('pointer-gesture suppression', () => {
  it('hides while a press inside the editor is unreleased', () => {
    const view = mount([textBlock('hello world')]);
    selectAll(view);
    pressInEditor(view);
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
  });

  it('stays hidden as the dragged selection grows', () => {
    const view = mount([textBlock('hello world')]);
    pressInEditor(view);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 8)));
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
  });

  it('appears once, on release, over the finished selection', () => {
    const view = mount([textBlock('hello world')]);
    pressInEditor(view);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 8)));
    releasePointer();
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);
  });

  it('a click that selects nothing leaves it hidden', () => {
    const view = mount([textBlock('hello world')]);
    selectAll(view);
    pressInEditor(view);
    collapseCaret(view);
    releasePointer();
    settle();
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
  });
});

describe('a press outside the editor dismisses the toolbar', () => {
  it('hides even though the selection is still a range', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);

    pressOutside();
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
    expect(view.state.selection.empty).toBe(false);
  });

  it('stays dismissed while nothing in the document changes', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    pressOutside();
    // A doc-only change must not resurrect a toolbar the user dismissed.
    view.dispatch(view.state.tr.insertText('!', 2));
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
  });

  it('comes back on the next real selection change', () => {
    const view = mount([textBlock('hello world')]);
    selectAll(view);
    pressOutside();
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 5)));
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);
  });

  it('a press on the toolbar itself is not a dismissal', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    button('editor.bold').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);
  });

  it('a press inside the editor is a new gesture, not a dismissal', () => {
    const view = mount([textBlock('hello world')]);
    selectAll(view);
    pressInEditor(view);
    releasePointer();
    // Dismissed would mean staying hidden until the next deliberate selection
    // change; this comes straight back with the selection still standing.
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);
  });
});

describe('buttons run the catalog\'s own commands', () => {
  it('renders bold/italic/underline/strikethrough/highlight/sub/sup/equation', () => {
    mount([textBlock('hello')]);
    for (const id of [
      'editor.bold',
      'editor.italic',
      'editor.underline',
      'editor.strikethrough',
      'editor.highlight',
      'editor.subscript',
      'editor.superscript',
      'editor.equation',
    ]) {
      expect(() => button(id)).not.toThrow();
    }
  });

  it('labels each button from the NotesEditor bundle, never a raw key', () => {
    mount([textBlock('hello')]);
    expect(button('editor.bold').title).toBe('t:BoldTooltip');
    expect(button('editor.equation').title).toBe('t:EquationTooltip');
  });

  it('clicking bold sets the mark across the selection', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    button('editor.bold').click();
    let bold = false;
    view.state.doc.descendants((node) => {
      if (node.isText && schema.marks.strong.isInSet(node.marks)) bold = true;
      return true;
    });
    expect(bold).toBe(true);
  });

  it('reflects the active state of the current selection', () => {
    const view = mount([textBlock('hello', { bold: true })]);
    selectAll(view);
    expect(button('editor.bold').classList.contains('is-active')).toBe(true);
    expect(button('editor.italic').classList.contains('is-active')).toBe(false);
  });

  it('disables a button the catalog would refuse, bold inside a code block', () => {
    const view = mount([codeBlock('const x = 1;')]);
    selectAll(view);
    expect(button('editor.bold').disabled).toBe(true);
  });
});

describe('a mousedown on the toolbar never steals editor focus', () => {
  it('preventDefault is called on the toolbar root', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button('editor.bold').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('the colour swatch popover', () => {
  it('is closed until the colour button opens it', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    expect(popoverEl().hasAttribute('data-hidden')).toBe(true);
    colorButton().click();
    expect(popoverEl().hasAttribute('data-hidden')).toBe(false);
  });

  it('applies a text swatch token and marks its cell selected', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    colorButton().click();
    cell('text', 'swatch5').click();

    let token: unknown;
    view.state.doc.descendants((node) => {
      if (node.isText) {
        const mark = node.marks.find((m) => m.type === schema.marks.fgSwatch);
        if (mark) token = mark.attrs.token;
      }
      return true;
    });
    expect(token).toBe('swatch5');

    colorButton().click();
    expect(cell('text', 'swatch5').classList.contains('is-selected')).toBe(true);
  });

  it('the default cell clears a previously applied text colour', () => {
    const view = mount([textBlock('hello', { foregroundColor: 'swatch3' })]);
    selectAll(view);
    colorButton().click();
    cell('text', 'none').click();

    let hasMark = false;
    view.state.doc.descendants((node) => {
      if (node.isText && schema.marks.fgSwatch.isInSet(node.marks)) hasMark = true;
      return true;
    });
    expect(hasMark).toBe(false);
  });

  it('the two rows apply to different mark families, not to each other', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    colorButton().click();
    cell('background', 'swatch7').click();

    let fg: unknown;
    let bg: unknown;
    view.state.doc.descendants((node) => {
      if (node.isText) {
        fg = node.marks.find((m) => m.type === schema.marks.fgSwatch)?.attrs.token;
        bg = node.marks.find((m) => m.type === schema.marks.bgSwatch)?.attrs.token;
      }
      return true;
    });
    expect(bg).toBe('swatch7');
    expect(fg).toBeUndefined();
  });

  it('closes on an outside click, leaving the toolbar itself open', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    colorButton().click();
    expect(popoverEl().hasAttribute('data-hidden')).toBe(false);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(popoverEl().hasAttribute('data-hidden')).toBe(true);
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);
  });
});

/**
 * That the palette is placed against the toolbar's real position, rather than
 * always hanging below and to the left of it. The arithmetic belongs to
 * `position.test.ts`; what is asserted here is that the measurement reaches it.
 */
describe('keeping the palette on screen', () => {
  const VIEWPORT = { width: 1000, height: 800 };

  /** jsdom lays nothing out, so the numbers the placement reads are supplied. */
  function putToolbarAt(top: number, left: number): void {
    const rect = { top, bottom: top + 40, left, right: left + 300 };
    toolbarEl().getBoundingClientRect = () => rect as DOMRect;
    Object.defineProperty(popoverEl(), 'offsetWidth', { value: 240, configurable: true });
    Object.defineProperty(popoverEl(), 'offsetHeight', { value: 130, configurable: true });
    vi.stubGlobal('innerWidth', VIEWPORT.width);
    vi.stubGlobal('innerHeight', VIEWPORT.height);
  }

  function opensAbove(): boolean {
    return popoverEl().classList.contains('notes-formatting-toolbar-swatch-popover-above');
  }

  it('leaves the palette below a toolbar with room under it', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    putToolbarAt(200, 400);
    colorButton().click();
    expect(opensAbove()).toBe(false);
  });

  it('flips the palette above a toolbar near the bottom edge', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    putToolbarAt(VIEWPORT.height - 60, 400);
    colorButton().click();
    expect(opensAbove()).toBe(true);
  });

  it('takes the flip back off once the toolbar has room again', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    putToolbarAt(VIEWPORT.height - 60, 400);
    colorButton().click();
    expect(opensAbove()).toBe(true);

    colorButton().click();
    putToolbarAt(200, 400);
    colorButton().click();
    expect(opensAbove()).toBe(false);
  });

  it('pulls the palette back in when it would run off the right edge', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    putToolbarAt(200, 860);
    colorButton().click();
    // 1000 wide, less the 240 palette and the 4px margin, less the toolbar's
    // own left: the palette starts left of the toolbar it hangs from.
    expect(popoverEl().style.left).toBe('-104px');
  });

  it('places the palette again when the window changes under it', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    putToolbarAt(200, 400);
    colorButton().click();
    expect(popoverEl().style.left).toBe('0px');

    putToolbarAt(200, 860);
    window.dispatchEvent(new Event('resize'));
    expect(popoverEl().style.left).toBe('-104px');
  });

  it('measures nothing while the palette is hidden', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    putToolbarAt(200, 860);
    expect(popoverEl().style.left).toBe('');
  });
});

/**
 * The desktop toolbar is `Focusable="False"`, so none of this is parity: it is
 * the toolbar becoming reachable by something other than a pointer.
 */
describe('reaching the toolbar from the keyboard', () => {
  it('the entry chord moves focus onto the first control', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    expect(pressInDocument(view, 'F10', { altKey: true })).toBe(true);
    expect(focusedCommand()).toBe('color');
  });

  it('declines the chord while the toolbar is not showing', () => {
    const view = mount([textBlock('hello')]);
    collapseCaret(view);
    settle();
    expect(pressInDocument(view, 'F10', { altKey: true })).toBe(false);
    expect(toolbarHasFocus()).toBe(false);
  });

  it('leaves a bare F10 to the browser', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    expect(pressInDocument(view, 'F10')).toBe(false);
  });

  it('is a single tab stop, not one per control', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    const stops = [...toolbarEl().querySelectorAll('button')].filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
  });
});

describe('moving around inside the toolbar', () => {
  function enter(view: EditorView): void {
    selectAll(view);
    pressInDocument(view, 'F10', { altKey: true });
  }

  it('the arrows walk the controls', () => {
    const view = mount([textBlock('hello')]);
    enter(view);
    pressFocused('ArrowRight');
    expect(focusedCommand()).toBe('editor.bold');
    pressFocused('ArrowRight');
    expect(focusedCommand()).toBe('editor.italic');
    pressFocused('ArrowLeft');
    expect(focusedCommand()).toBe('editor.bold');
  });

  it('End reaches the last control', () => {
    const view = mount([textBlock('hello')]);
    enter(view);
    pressFocused('End');
    expect(focusedCommand()).toBe('editor.equation');
  });

  /**
   * A heading holds bold through an invariant, so the command refuses and the
   * arrows step over it rather than landing where a press would do nothing.
   * Italic is untouched there, which is what makes this a step over one control
   * rather than a toolbar with nothing left in it.
   */
  it('steps over a command the catalog refuses', () => {
    const view = mount([headingBlock('a title')]);
    enter(view);
    expect(button('editor.bold').disabled).toBe(true);
    expect(button('editor.italic').disabled).toBe(false);
    expect(focusedCommand()).toBe('color');
    pressFocused('ArrowRight');
    expect(focusedCommand()).toBe('editor.italic');
  });

  /** The way in must never be a control that would refuse the press. */
  it('the tab stop is never left on a refused control', () => {
    const view = mount([headingBlock('a title')]);
    selectAll(view);
    const stops = [...toolbarEl().querySelectorAll('button')].filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].disabled).toBe(false);
  });

  /**
   * The tab stop is placed when the toolbar is built, before any selection has
   * said which controls are available. A catalog that refuses the colour
   * command puts it on a disabled control, which is what separates settling it
   * once from settling it on every readout.
   */
  it('moves the tab stop off the first control when that one is refused', () => {
    const refusesColor = EDITOR_COMMANDS.map((command) =>
      command.id === 'editor.color.foreground' && command.kind === 'swatch'
        ? { ...command, runWith: () => () => false }
        : command,
    );
    const view = mount([textBlock('hello')], refusesColor);
    selectAll(view);
    expect(colorButton().disabled).toBe(true);
    expect(colorButton().tabIndex).toBe(-1);
    expect(button('editor.bold').tabIndex).toBe(0);
  });

  it('a press runs the focused command, the same one its click runs', () => {
    const view = mount([textBlock('hello')]);
    enter(view);
    pressFocused('ArrowRight');
    (document.activeElement as HTMLButtonElement).click();
    let bold = false;
    view.state.doc.descendants((node) => {
      if (node.isText && schema.marks.strong.isInSet(node.marks)) bold = true;
      return true;
    });
    expect(bold).toBe(true);
  });

  it('consumes the keys it acts on, so nothing else reads them as scrolling', () => {
    const view = mount([textBlock('hello')]);
    enter(view);
    expect(pressFocused('ArrowRight').defaultPrevented).toBe(true);
    expect(pressFocused('PageDown').defaultPrevented).toBe(false);
  });
});

describe('Escape hands the caret back', () => {
  it('puts focus back in the document, not merely out of the toolbar', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    pressInDocument(view, 'F10', { altKey: true });
    expect(toolbarHasFocus()).toBe(true);
    pressFocused('Escape');
    expect(document.activeElement).toBe(view.dom);
  });

  /**
   * Not just a refocus: the selection is put back to what it was when the
   * toolbar took focus, which is the whole reason a scope is captured.
   */
  it('restores the selection the toolbar was opened over', () => {
    const view = mount([textBlock('hello world')]);
    selectAll(view);
    const { from, to } = view.state.selection;
    pressInDocument(view, 'F10', { altKey: true });

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)));
    pressFocused('Escape');

    expect(view.state.selection.from).toBe(from);
    expect(view.state.selection.to).toBe(to);
  });

  it('leaves the toolbar up, because the selection is still a range', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    pressInDocument(view, 'F10', { altKey: true });
    pressFocused('Escape');
    settle();
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(false);
  });

  it('stands down one layer at a time, palette first', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    pressInDocument(view, 'F10', { altKey: true });
    colorButton().click();
    expect(popoverEl().hasAttribute('data-hidden')).toBe(false);

    pressFocused('Escape');
    expect(popoverEl().hasAttribute('data-hidden')).toBe(true);
    expect(toolbarHasFocus()).toBe(true);

    pressFocused('Escape');
    expect(toolbarHasFocus()).toBe(false);
  });
});

describe('the palette from the keyboard', () => {
  function openPalette(view: EditorView): void {
    selectAll(view);
    pressInDocument(view, 'F10', { altKey: true });
    colorButton().click();
  }

  it('opening it moves focus into the cells', () => {
    const view = mount([textBlock('hello')]);
    openPalette(view);
    expect(popoverEl().contains(document.activeElement)).toBe(true);
  });

  it('the arrows cross from the text row to the background row', () => {
    const view = mount([textBlock('hello')]);
    openPalette(view);
    const rows = popoverEl().querySelectorAll('.notes-formatting-toolbar-swatch-row');
    const first = focusedCommand();
    expect(rows[0].contains(document.activeElement)).toBe(true);
    pressFocused('ArrowDown');
    expect(rows[1].contains(document.activeElement)).toBe(true);
    pressFocused('ArrowUp');
    expect(rows[0].contains(document.activeElement)).toBe(true);
    expect(focusedCommand()).toBe(first);
  });

  it('closing it puts focus back on the button that opened it', () => {
    const view = mount([textBlock('hello')]);
    openPalette(view);
    pressFocused('Escape');
    expect(focusedCommand()).toBe('color');
  });

  /** A click already left the caret in the document on purpose. */
  it('a mouse press on the colour button does not pull focus out of the text', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    colorButton().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    colorButton().click();
    expect(popoverEl().hasAttribute('data-hidden')).toBe(false);
    expect(toolbarHasFocus()).toBe(false);
  });
});

describe('focus never strands itself', () => {
  it('goes back to the editor when the toolbar hides under it', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    pressInDocument(view, 'F10', { altKey: true });
    collapseCaret(view);
    settle();
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
    expect(toolbarHasFocus()).toBe(false);
  });

  /**
   * At mousedown the press has not taken focus yet, so a toolbar that refocused
   * the editor here would land the caret behind whatever was just clicked.
   */
  it('an outside press is not answered by grabbing focus back', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    pressInDocument(view, 'F10', { altKey: true });
    const before = document.activeElement;
    pressOutside();
    expect(document.activeElement).toBe(before);
  });
});

describe('what the toolbar tells a screen reader', () => {
  it('names itself as a toolbar', () => {
    mount([textBlock('hello')]);
    expect(toolbarEl().getAttribute('role')).toBe('toolbar');
    expect(toolbarEl().getAttribute('aria-orientation')).toBe('horizontal');
    expect(toolbarEl().getAttribute('aria-label')).toBe('t:FormattingToolbar');
  });

  it('a toggle reports whether it is on', () => {
    const view = mount([textBlock('hello', { bold: true })]);
    selectAll(view);
    expect(button('editor.bold').getAttribute('aria-pressed')).toBe('true');
    expect(button('editor.italic').getAttribute('aria-pressed')).toBe('false');
  });

  /** An insert is never "on", and the catalog already says so by omitting `isActive`. */
  it('an insert claims no pressed state at all', () => {
    mount([textBlock('hello')]);
    expect(button('editor.equation').hasAttribute('aria-pressed')).toBe(false);
  });

  it('an icon button carries its tooltip as its name', () => {
    mount([textBlock('hello')]);
    expect(button('editor.bold').getAttribute('aria-label')).toBe('t:BoldTooltip');
  });

  it('the colour button reports whether the palette is open', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    expect(colorButton().getAttribute('aria-expanded')).toBe('false');
    colorButton().click();
    expect(colorButton().getAttribute('aria-expanded')).toBe('true');
    colorButton().click();
    expect(colorButton().getAttribute('aria-expanded')).toBe('false');
  });

  /** Named by the heading already on screen, so the two cannot drift apart. */
  it('each swatch row is named by its own heading', () => {
    mount([textBlock('hello')]);
    const rows = popoverEl().querySelectorAll('.notes-formatting-toolbar-swatch-row');
    const headings = [...rows].map((row) => {
      const id = row.getAttribute('aria-labelledby') ?? '';
      return document.getElementById(id)?.textContent;
    });
    expect(headings).toEqual(['t:TextColor', 't:BackgroundColor']);
  });

  it('a selected swatch reports itself pressed', () => {
    const view = mount([textBlock('hello', { foregroundColor: 'swatch3' })]);
    selectAll(view);
    expect(cell('text', 'swatch3').getAttribute('aria-pressed')).toBe('true');
    expect(cell('text', 'swatch5').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('teardown', () => {
  it('destroy removes the toolbar from the document', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    expect(document.querySelector('.notes-formatting-toolbar')).not.toBeNull();
    view.destroy();
    expect(document.querySelector('.notes-formatting-toolbar')).toBeNull();
  });
});
