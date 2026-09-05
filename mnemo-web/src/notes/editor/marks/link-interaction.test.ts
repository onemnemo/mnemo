// @vitest-environment jsdom

/**
 * What a click on a link inside an editable note does, driven through a real
 * mounted view so the mark is read out of an actual document.
 *
 * Placement is not asserted: jsdom measures everything as zero, which is
 * `floating/position.test.ts`'s job.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { block, span } from '../mapper/fixtures';
import type { Block } from '../../model/types';
import { editorHistory } from '../history';
import { buildNoteEditState } from '../../edit/build-edit-state';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import { linkInteractionPlugin } from './link-interaction';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

const opened: string[] = [];
vi.mock('@/lib/external', () => ({
  openExternally: (url: string) => {
    opened.push(url);
  },
}));

beforeAll(() => {
  (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
});

beforeEach(() => {
  opened.length = 0;
});

afterEach(() => {
  document.body.replaceChildren();
});

function linkNote(href: string, text = 'the docs'): Block[] {
  return [block('Text', [span('see '), span(text, { linkUrl: href }), span(' today')])];
}

function mount(blocks: Block[]): EditorView {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, {
    state: EditorState.create({
      doc: result.doc,
      schema,
      plugins: [editorHistory(), linkInteractionPlugin()],
    }),
  });
}

function anchorIn(view: EditorView): HTMLAnchorElement {
  const el = view.dom.querySelector('a[href]');
  if (!(el instanceof HTMLAnchorElement)) throw new Error('no link rendered');
  return el;
}

function chip(): HTMLElement | null {
  return document.querySelector('.notes-link-chip');
}

function chipButton(label: string): HTMLButtonElement {
  const el = chip()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!el) throw new Error(`no "${label}" button`);
  return el;
}

/** The caret inside the link run, which a real click on it would have placed. */
function caretInLink(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)));
}

function clickLink(view: EditorView, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  anchorIn(view).dispatchEvent(event);
  return event;
}

describe('the navigation guard', () => {
  /**
   * The window is chromeless. A link that navigates replaces the application
   * with a web page and leaves no way back, and a modifier press is not the
   * plain click the browser declines to follow inside a contenteditable.
   */
  it('takes the default off every anchor activation inside the editor', () => {
    const view = mount(linkNote('https://example.com/docs'));
    expect(clickLink(view).defaultPrevented).toBe(true);
  });

  it('takes it off a modifier click too', () => {
    const view = mount(linkNote('https://example.com/docs'));
    expect(clickLink(view, { ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it('takes it off the middle button, which asks for a window there is none of', () => {
    const view = mount(linkNote('https://example.com/docs'));
    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    anchorIn(view).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('a plain click', () => {
  it('raises the chip, showing where the link goes', () => {
    const view = mount(linkNote('https://example.com/docs'));
    caretInLink(view);
    clickLink(view);
    expect(chip()?.querySelector('.notes-link-chip-href')?.textContent).toBe(
      'https://example.com/docs',
    );
  });

  it('opens nothing by itself', () => {
    const view = mount(linkNote('https://example.com/docs'));
    caretInLink(view);
    clickLink(view);
    expect(opened).toEqual([]);
  });

  it('raises no chip for a click that is not on a link', () => {
    const view = mount(linkNote('https://example.com/docs'));
    view.dom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(chip()).toBeNull();
  });
});

describe('a modifier click', () => {
  it('goes straight to the browser, with no chip in the way', () => {
    const view = mount(linkNote('https://example.com/docs'));
    clickLink(view, { ctrlKey: true });
    expect(opened).toEqual(['https://example.com/docs']);
    expect(chip()).toBeNull();
  });

  it('answers the same to the command key', () => {
    const view = mount(linkNote('https://example.com/docs'));
    clickLink(view, { metaKey: true });
    expect(opened).toEqual(['https://example.com/docs']);
  });

  /** The host launches http and https only, so there is nothing to hand these to. */
  it('opens nothing for an address the host cannot launch', () => {
    const view = mount(linkNote('mailto:someone@example.com'));
    clickLink(view, { ctrlKey: true });
    expect(opened).toEqual([]);
  });
});

describe('the chip\'s own rows', () => {
  it('opens through the host rather than the window', () => {
    const view = mount(linkNote('https://example.com/docs'));
    caretInLink(view);
    clickLink(view);
    chipButton('LinkOpen').click();
    expect(opened).toEqual(['https://example.com/docs']);
    expect(chip()).toBeNull();
  });

  it('offers no Open for an address the host cannot launch', () => {
    const view = mount(linkNote('mailto:someone@example.com'));
    caretInLink(view);
    clickLink(view);
    expect(chipButton('LinkOpen').disabled).toBe(true);
  });

  it('clears the mark in one undo step, leaving the text', () => {
    const view = mount(linkNote('https://example.com/docs'));
    caretInLink(view);
    clickLink(view);
    chipButton('InsertLinkRemoveLink').click();

    expect(view.dom.querySelector('a[href]')).toBeNull();
    expect(view.state.doc.textContent).toBe('see the docs today');
    expect(chip()).toBeNull();
  });
});

describe('dismissal', () => {
  function open(): EditorView {
    const view = mount(linkNote('https://example.com/docs'));
    caretInLink(view);
    clickLink(view);
    expect(chip()).not.toBeNull();
    return view;
  }

  it('goes on an outside press', () => {
    open();
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(chip()).toBeNull();
  });

  it('stays for a press on itself', () => {
    open();
    chipButton('LinkOpen').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(chip()).not.toBeNull();
  });

  it('goes on Escape', () => {
    open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(chip()).toBeNull();
  });

  it('goes once the caret has left the link', () => {
    const view = open();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(chip()).toBeNull();
  });

  it('stays while the caret only moves within the link', () => {
    const view = open();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9)));
    expect(chip()).not.toBeNull();
  });
});

describe('inside the whole editable stack', () => {
  /**
   * The full plugin list, because two of the things under test are seams
   * between plugins: the flyout the Edit row opens belongs to the formatting
   * toolbar, and a page card is an anchor drawn by a node view rather than a
   * link mark.
   */
  function mountReal(blocks: Block[]): EditorView {
    const built = buildNoteEditState(blocks);
    if (!built.ok) throw new Error('fixture did not build');
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new EditorView(host, {
      state: built.state,
      // A resolver, so a page card reaches its ready state and draws the href
      // that makes it look exactly like a link to a DOM-only test.
      nodeViews: toNodeViews(
        built.registry,
        resolveServices({ resolveNoteTitle: () => 'Another note' }),
      ),
    });
  }

  it('hands Edit to the flyout the toolbar and the chord already share', () => {
    const view = mountReal(linkNote('https://example.com/docs'));
    caretInLink(view);
    clickLink(view);
    chipButton('EditLinkTitle').click();

    const flyout = document.querySelector('.notes-link-flyout');
    expect(flyout).not.toBeNull();
    expect(flyout?.querySelector('input')?.value).toBe('https://example.com/docs');
    // One layer at a time: the chip has handed over rather than stacked.
    expect(chip()).toBeNull();
    view.destroy();
  });

  /**
   * A page card renders an anchor too, and routes its own click. Reading the
   * mark out of the document rather than guessing from the DOM is what keeps
   * the chip off it.
   */
  it('raises no chip on a page card, which is not a link mark', () => {
    const view = mountReal([block('Page', [span('')], { kind: 'page', referenceNoteId: 'n1' })]);
    const card = view.dom.querySelector('a[href]');
    expect(card).not.toBeNull();
    card?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(chip()).toBeNull();
    view.destroy();
  });
});

describe('teardown', () => {
  it('destroy takes the chip out of the document', () => {
    const view = mount(linkNote('https://example.com/docs'));
    caretInLink(view);
    clickLink(view);
    view.destroy();
    expect(chip()).toBeNull();
  });
});
