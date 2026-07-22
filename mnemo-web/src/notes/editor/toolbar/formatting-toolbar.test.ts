// @vitest-environment jsdom

/**
 * The formatting toolbar plugin. `coordsAtPos`-based positioning is not asserted here:
 * jsdom has no real layout engine, so real pixel output is `position.test.ts`'s
 * job. This covers what a headless `EditorView` can actually prove: the plugin
 * shows/hides with the selection, its buttons run the same commands the
 * catalog describes and agree with the same active/enabled readouts, the
 * swatch popover applies and clears tokens, and teardown leaves nothing behind.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { block, span } from '../mapper/fixtures';
import type { Block } from '../../model/types';
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

afterEach(() => {
  document.body.replaceChildren();
});

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function mount(blocks: Block[]): EditorView {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  const state = EditorState.create({
    doc: result.doc,
    schema,
    // Labels are asserted as keys, not as whatever the shipped bundle says, so
    // a translation edit cannot break a test about behaviour.
    plugins: [formattingToolbarPlugin({ translate: (key) => `t:${key}` })],
  });
  return new EditorView(container(), { state });
}

function textBlock(text: string, extra: Parameters<typeof span>[1] = {}): Block {
  return block('Text', [span(text, extra)]);
}

function codeBlock(text: string): Block {
  return block('Code', [span(text)], { kind: 'code', language: 'text', source: text });
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
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    expect(toolbarEl().hasAttribute('data-hidden')).toBe(true);
  });
});

describe('a press outside the editor dismisses the toolbar', () => {
  /** The one gesture PM itself does not report: it keeps its selection when
   * focus leaves, so without this the bubble would hang over the page. */
  function pressOutside(): void {
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }

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

  it('a press inside the editor is not a dismissal, PM reports that itself', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
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

describe('teardown', () => {
  it('destroy removes the toolbar from the document', () => {
    const view = mount([textBlock('hello')]);
    selectAll(view);
    expect(document.querySelector('.notes-formatting-toolbar')).not.toBeNull();
    view.destroy();
    expect(document.querySelector('.notes-formatting-toolbar')).toBeNull();
  });
});
