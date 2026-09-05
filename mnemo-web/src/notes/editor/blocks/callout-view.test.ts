// @vitest-environment jsdom

/**
 * The callout's glyph: that it is a control, and that being one costs the
 * document nothing.
 *
 * The first half reads the view on its own, the way the checklist's box is read.
 * The second mounts a real editor with the block views installed, because the
 * thing a NodeView can break is not its own markup but the caret: a control
 * drawn inside an editable block is exactly how a selection ends up somewhere
 * there is nothing to type into.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { selectAll } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { backspaceStructural, splitBlock } from '../commands/structure';
import { block, span } from '../mapper/fixtures';
import { createEditorSchema } from '../schema';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import type { BlockShellHost, EditorServices, RealizedBlockViewArgs } from '../registry/types';
import { calloutIconRequest, closeCalloutIcon, openCalloutIcon } from '../chrome/callout-icon-request';
import { calloutView } from './callout-view';

const { schema } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function callout(emoji: string, text = 'remember'): PMNode {
  return schema.nodes.callout.create({ emoji, tone: 'note', sid: 'c1' }, line(text));
}

const host: BlockShellHost = { mode: 'realized', requestMode() {}, destroy() {} };
const services: EditorServices = resolveServices();

/** A view double carrying a real state, the same shape the checklist's box is read through. */
function mountView(emoji: string, editable = true) {
  const doc = schema.nodes.doc.create(null, [callout(emoji)]);
  let state = EditorState.create({ schema, doc });
  const view = {
    get state() {
      return state;
    },
    editable,
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
  } as unknown as EditorView;

  const args: RealizedBlockViewArgs<Record<string, unknown>> = {
    node: doc.firstChild!,
    view,
    getPos: () => 0,
    attrs: doc.firstChild!.attrs,
    host,
    services,
  };
  const realized = calloutView(args);
  const glyph = realized.dom.querySelector('.notes-callout-glyph') as HTMLButtonElement;
  return { realized, glyph };
}

function press(glyph: HTMLElement): void {
  glyph.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  glyph.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  glyph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  closeCalloutIcon();
});

describe('callout NodeView', () => {
  it('draws the glyph as a button outside the editable body', () => {
    const { realized, glyph } = mountView('💡');
    expect(realized.dom.tagName).toBe('ASIDE');
    expect(realized.dom.getAttribute('data-callout')).toBe('');
    expect(realized.dom.getAttribute('data-callout-emoji')).toBe('💡');
    expect(glyph.textContent).toBe('💡');
    expect(glyph.getAttribute('contenteditable')).toBe('false');
    expect(glyph.tabIndex).toBe(-1);
    // The editable content lives in the body, never inside the button.
    expect(realized.contentDOM).toBe(realized.dom.querySelector('.notes-callout-body'));
    expect(glyph.contains(realized.contentDOM!)).toBe(false);
  });

  it('names the glyph for assistive tech', () => {
    const { glyph } = mountView('💡');
    expect(glyph.getAttribute('aria-label')).toBe('CalloutIcon');
  });

  it('draws no glyph column at all when the callout has none', () => {
    const { realized, glyph } = mountView('');
    expect(glyph.hidden).toBe(true);
    expect(realized.dom.getAttribute('data-callout-emoji')).toBe('');
  });

  it('writes a changed glyph in place rather than rebuilding', () => {
    const { realized, glyph } = mountView('💡');
    expect(realized.update!(callout('🚀'))).toBe(true);
    // The same element, or a picker anchored to it would be left floating.
    expect(realized.dom.querySelector('.notes-callout-glyph')).toBe(glyph);
    expect(glyph.textContent).toBe('🚀');
    expect(glyph.hidden).toBe(false);
    // Clearing it puts the callout back to a plain tinted aside.
    expect(realized.update!(callout(''))).toBe(true);
    expect(glyph.hidden).toBe(true);
  });

  it('refuses an update to a different node type', () => {
    const { realized } = mountView('💡');
    expect(realized.update!(schema.nodes.paragraph.create(null, line('x')))).toBe(false);
  });

  it('owns its chrome mutations and nothing in the body', () => {
    const { realized, glyph } = mountView('💡');
    const attrOnAside = { type: 'attributes', target: realized.dom } as unknown as MutationRecord;
    const insideGlyph = { type: 'childList', target: glyph } as unknown as MutationRecord;
    const inBody = { type: 'characterData', target: realized.contentDOM! } as unknown as MutationRecord;
    const selection = { type: 'selection', target: realized.contentDOM! } as const;
    expect(realized.ignoreMutation!(attrOnAside)).toBe(true);
    expect(realized.ignoreMutation!(insideGlyph)).toBe(true);
    expect(realized.ignoreMutation!(inBody)).toBe(false);
    expect(realized.ignoreMutation!(selection)).toBe(false);
  });

  it('asks for the picker on the block it was drawn for', () => {
    const { glyph } = mountView('💡');
    press(glyph);
    expect(calloutIconRequest()).toEqual({ pos: 0, sid: 'c1' });
  });

  it('closes a picker that is already up rather than reopening it', () => {
    const { glyph } = mountView('💡');
    press(glyph);
    press(glyph);
    expect(calloutIconRequest()).toBeNull();
  });

  it('takes the picker off another callout rather than putting it away', () => {
    const { glyph } = mountView('💡');
    openCalloutIcon({ pos: 40, sid: 'elsewhere' });
    press(glyph);
    expect(calloutIconRequest()).toEqual({ pos: 0, sid: 'c1' });
  });

  it('offers nothing in a read-only view', () => {
    const { glyph } = mountView('💡', false);
    press(glyph);
    expect(calloutIconRequest()).toBeNull();
  });

  it('stops the press from moving the caret', () => {
    const { glyph } = mountView('💡');
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    glyph.dispatchEvent(mousedown);
    // The browser places the caret on mousedown, so a control inside an editable
    // block has to swallow it or the selection lands in the glyph.
    expect(mousedown.defaultPrevented).toBe(true);
  });

  it('leaves the press alone in a read-only view', () => {
    const { glyph } = mountView('💡', false);
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    glyph.dispatchEvent(mousedown);
    // No caret to keep out of the glyph there, and swallowing the press is what
    // would stop a reader starting a text selection on it.
    expect(mousedown.defaultPrevented).toBe(false);
  });

  it('stops listening once it is destroyed', () => {
    const { glyph, realized } = mountView('💡');
    realized.destroy!();
    press(glyph);
    expect(calloutIconRequest()).toBeNull();
  });
});

// --- the caret, against a real editor ---------------------------------------

type Blocks = Parameters<typeof buildNoteEditState>[0];

const note: Blocks = [
  block('Text', [span('before')]),
  block('Callout', [span('remember')], { kind: 'callout', emoji: '💡', tone: 'note' }),
  block('Text', [span('after')]),
];

interface Mounted {
  view: EditorView;
  glyph: HTMLElement;
  /** Position just before the callout, the second top-level block. */
  calloutPos: number;
}

function mountEditor(blocks: Blocks = note): Mounted {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, {
    state: built.state,
    nodeViews: toNodeViews(built.registry, resolveServices()),
  });
  const glyph = view.dom.querySelector('.notes-callout-glyph');
  if (!(glyph instanceof HTMLElement)) throw new Error('no glyph');
  return { view, glyph, calloutPos: view.state.doc.child(0).nodeSize };
}

/** Put the caret `offset` characters into the callout's own line. */
function caret(view: EditorView, calloutPos: number, offset: number): void {
  const pos = calloutPos + 2 + offset;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

/** Every top-level block as its type name and its text. */
function shape(view: EditorView): string[] {
  const out: string[] = [];
  view.state.doc.forEach((node) => out.push(`${node.type.name}:${node.textContent}`));
  return out;
}

describe('the callout caret', () => {
  it('resolves every position in the callout inside the body, never in the glyph', () => {
    const { view, glyph, calloutPos } = mountEditor();
    const node = view.state.doc.child(1);
    for (let pos = calloutPos + 2; pos <= calloutPos + node.nodeSize - 2; pos++) {
      const at = view.domAtPos(pos).node;
      expect(glyph.contains(at)).toBe(false);
    }
  });

  it('leaves the selection alone when the glyph is pressed', () => {
    const { view, glyph, calloutPos } = mountEditor();
    caret(view, calloutPos, 3);
    const before = view.state.selection.head;
    press(glyph);
    expect(view.state.selection.head).toBe(before);
  });

  it('types into the callout the way it types into any block', () => {
    const { view, calloutPos } = mountEditor();
    caret(view, calloutPos, 8);
    view.dispatch(view.state.tr.insertText('!'));
    expect(shape(view)).toEqual(['paragraph:before', 'callout:remember!', 'paragraph:after']);
  });

  it('splits on Enter at the caret, and the tail is a plain paragraph', () => {
    const { view, calloutPos } = mountEditor();
    caret(view, calloutPos, 4);
    expect(splitBlock(view.state, view.dispatch)).toBe(true);
    expect(shape(view)).toEqual([
      'paragraph:before',
      'callout:reme',
      'paragraph:mber',
      'paragraph:after',
    ]);
  });

  it('strips the callout on Backspace at the start, then merges on the next', () => {
    const { view, calloutPos } = mountEditor();
    caret(view, calloutPos, 0);
    expect(backspaceStructural(view.state, view.dispatch)).toBe(true);
    // The first press takes the block's type, glyph and all; the second is the
    // ordinary merge into the block above.
    expect(shape(view)).toEqual(['paragraph:before', 'paragraph:remember', 'paragraph:after']);
    expect(view.dom.querySelector('.notes-callout-glyph')).toBeNull();
    expect(backspaceStructural(view.state, view.dispatch)).toBe(true);
    expect(shape(view)).toEqual(['paragraph:beforeremember', 'paragraph:after']);
  });

  it('takes the callout with a select-all, leaving no glyph behind', () => {
    const { view } = mountEditor();
    selectAll(view.state, view.dispatch);
    view.dispatch(view.state.tr.deleteSelection());
    expect(view.state.doc.textContent).toBe('');
    expect(view.dom.querySelector('.notes-callout-glyph')).toBeNull();
  });

  it('takes only the text a selection dragged across the callout covers', () => {
    const { view, calloutPos } = mountEditor();
    const from = 2 + 'befo'.length;
    const to = calloutPos + 2 + 'reme'.length;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    view.dispatch(view.state.tr.deleteSelection());
    expect(shape(view)).toEqual(['paragraph:befomber', 'paragraph:after']);
  });
});
