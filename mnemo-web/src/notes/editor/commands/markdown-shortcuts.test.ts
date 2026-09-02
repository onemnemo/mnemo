// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { invariantPipeline } from '../pipeline/invariants';
import { inputTriggerPlugin } from '../pipeline/input-triggers';
import { lineIsCaretTarget } from '../blocks/shared';

const { schema, registry } = createEditorSchema();
const strong = schema.marks.strong.create();

// --- doc builders -----------------------------------------------------------

function line(...content: PMNode[]): PMNode {
  return schema.nodes.line.create(null, content.length > 0 ? content : null);
}
function para(text?: string, attrs?: Record<string, unknown>): PMNode {
  return schema.nodes.paragraph.create(attrs ?? null, text ? line(schema.text(text)) : line());
}
function bullet(text?: string): PMNode {
  return schema.nodes.bulletItem.create(null, text ? line(schema.text(text)) : line());
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

// --- harness ----------------------------------------------------------------

/** Absolute position of `offset` inside the line of the `blockIndex`-th top block. */
function caretAt(document: PMNode, blockIndex: number, offset: number): number {
  let start = -1;
  document.forEach((_node, off, index) => {
    if (index === blockIndex) start = off;
  });
  return start + 2 + offset;
}

/**
 * Simulates typing `char` at `caret`, driving the input-trigger plugin the way a
 * view would. Returns the resulting state and whether the plugin handled (and so
 * suppressed) the character.
 */
function type(document: PMNode, caret: number, char: string): { state: EditorState; handled: boolean } {
  const plugin = inputTriggerPlugin(registry);
  const initial = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, caret),
    plugins: [invariantPipeline(registry)],
  });
  const view = {
    state: initial,
    dispatch(tr: import('prosemirror-state').Transaction) {
      view.state = view.state.apply(tr);
    },
  };
  const handled = plugin.props.handleTextInput!.call(
    plugin,
    view as unknown as EditorView,
    caret,
    caret,
    char,
    () => view.state.tr,
  );
  return { state: view.state, handled: Boolean(handled) };
}

/** The `blockIndex`-th top-level block of a document. */
function blockAt(document: PMNode, blockIndex: number): PMNode {
  let found: PMNode | null = null;
  document.forEach((node, _off, index) => {
    if (index === blockIndex) found = node;
  });
  return found!;
}

/** Whether every text run in a block's line carries `strong`. */
function allBold(block: PMNode): boolean {
  const first = block.firstChild;
  if (!first || first.content.size === 0) return false;
  let all = true;
  first.forEach((child) => {
    if (child.isText && !child.marks.some((m) => m.type.name === 'strong')) all = false;
  });
  return all;
}

// --- whole-line shortcuts ---------------------------------------------------

describe('markdown whole-line shortcuts', () => {
  it('converts "# " to an empty heading level 1', () => {
    const { state, handled } = type(doc(para('#')), caretAt(doc(para('#')), 0, 1), ' ');
    expect(handled).toBe(true);
    const h = blockAt(state.doc, 0);
    expect(h.type.name).toBe('heading');
    expect(h.attrs.level).toBe(1);
    expect(h.textContent).toBe('');
  });

  it('maps "## "/"### "/"#### " to the matching heading level', () => {
    for (const [marker, level] of [
      ['##', 2],
      ['###', 3],
      ['####', 4],
    ] as const) {
      const d = doc(para(marker));
      const { state, handled } = type(d, caretAt(d, 0, marker.length), ' ');
      expect(handled).toBe(true);
      const h = blockAt(state.doc, 0);
      expect(h.type.name).toBe('heading');
      expect(h.attrs.level).toBe(level);
    }
  });

  it('converts "> " to an empty quote', () => {
    const d = doc(para('>'));
    const { state, handled } = type(d, caretAt(d, 0, 1), ' ');
    expect(handled).toBe(true);
    expect(blockAt(state.doc, 0).type.name).toBe('quote');
  });

  it('converts both "[] " and "[ ] " to a checklist item', () => {
    for (const marker of ['[]', '[ ]']) {
      const d = doc(para(marker));
      const { state, handled } = type(d, caretAt(d, 0, marker.length), ' ');
      expect(handled).toBe(true);
      const c = blockAt(state.doc, 0);
      expect(c.type.name).toBe('checklistItem');
      expect(c.attrs.checked).toBe(false);
    }
  });

  it('converts "``` " to a code block whose line is a codeLine', () => {
    const d = doc(para('```'));
    const { state, handled } = type(d, caretAt(d, 0, 3), ' ');
    expect(handled).toBe(true);
    const c = blockAt(state.doc, 0);
    expect(c.type.name).toBe('codeBlock');
    expect(c.attrs.language).toBe('csharp');
    expect(c.firstChild!.type.name).toBe('codeLine');
  });

  it('converts "--- " to a divider', () => {
    const d = doc(para('---'));
    const { state, handled } = type(d, caretAt(d, 0, 3), ' ');
    expect(handled).toBe(true);
    expect(blockAt(state.doc, 0).type.name).toBe('divider');
  });

  it('lands the caret in a Text block below the divider, which holds no caret itself', () => {
    const d = doc(para('---'));
    const { state } = type(d, caretAt(d, 0, 3), ' ');
    // A divider draws as a bare rule with no content hole, so a caret left in
    // its line is invisible and everything typed next is saved into it unseen.
    expect(state.doc.childCount).toBe(2);
    expect(blockAt(state.doc, 1).type.name).toBe('paragraph');
    expect(state.selection.from).toBe(caretAt(state.doc, 1, 0));
    expect(lineIsCaretTarget(state.selection.$from.node(1).type)).toBe(true);
  });

  it('types on into that block rather than into the divider', () => {
    const d = doc(para('---'));
    const { state } = type(d, caretAt(d, 0, 3), ' ');
    const typed = state.apply(state.tr.insertText('and then'));
    expect(blockAt(typed.doc, 0).textContent).toBe('');
    expect(blockAt(typed.doc, 1).textContent).toBe('and then');
  });

  it('reuses the block already below rather than adding a second one', () => {
    const d = doc(para('---'), para('after'));
    const { state } = type(d, caretAt(d, 0, 3), ' ');
    expect(state.doc.childCount).toBe(2);
    expect(state.selection.from).toBe(caretAt(state.doc, 1, 0));
    expect(blockAt(state.doc, 1).textContent).toBe('after');
  });

  it('leaves the caret in the converted block when that block can hold one', () => {
    const d = doc(para('>'));
    const { state } = type(d, caretAt(d, 0, 1), ' ');
    expect(state.doc.childCount).toBe(1);
    expect(state.selection.from).toBe(caretAt(state.doc, 0, 0));
  });

  it('does not fire when text follows the caret (whole line is not the marker)', () => {
    const d = doc(para('#hello'));
    const { state, handled } = type(d, caretAt(d, 0, 1), ' ');
    expect(handled).toBe(false);
    // Untouched: still a paragraph reading "#hello".
    expect(blockAt(state.doc, 0).type.name).toBe('paragraph');
    expect(blockAt(state.doc, 0).textContent).toBe('#hello');
  });
});

// --- leading list markers ---------------------------------------------------

describe('markdown leading list markers', () => {
  it('converts "- ", "* ", "+ " to an empty bullet item', () => {
    for (const marker of ['-', '*', '+']) {
      const d = doc(para(marker));
      const { state, handled } = type(d, caretAt(d, 0, 1), ' ');
      expect(handled).toBe(true);
      const b = blockAt(state.doc, 0);
      expect(b.type.name).toBe('bulletItem');
      expect(b.textContent).toBe('');
    }
  });

  it('keeps the text after the marker as the bullet body', () => {
    const d = doc(para('-hello'));
    const { state, handled } = type(d, caretAt(d, 0, 1), ' ');
    expect(handled).toBe(true);
    const b = blockAt(state.doc, 0);
    expect(b.type.name).toBe('bulletItem');
    expect(b.textContent).toBe('hello');
  });

  it('converts "1. " to a numbered item (the number itself is not stored)', () => {
    const d = doc(para('1.'));
    const { state, handled } = type(d, caretAt(d, 0, 2), ' ');
    expect(handled).toBe(true);
    expect(blockAt(state.doc, 0).type.name).toBe('numberedItem');
  });

  it('keeps the remainder when a numbered marker has trailing text, ignoring the digit', () => {
    const d = doc(para('3.task'));
    const { state, handled } = type(d, caretAt(d, 0, 2), ' ');
    expect(handled).toBe(true);
    const n = blockAt(state.doc, 0);
    expect(n.type.name).toBe('numberedItem');
    expect(n.textContent).toBe('task');
  });

  it('preserves marks on the kept remainder', () => {
    const d = doc(
      schema.nodes.paragraph.create(null, line(schema.text('-'), schema.text('hi', [strong]))),
    );
    const { state, handled } = type(d, caretAt(d, 0, 1), ' ');
    expect(handled).toBe(true);
    const b = blockAt(state.doc, 0);
    expect(b.textContent).toBe('hi');
    expect(allBold(b)).toBe(true);
  });
});

// --- identity, filtering, and non-triggers ----------------------------------

describe('markdown shortcut boundaries', () => {
  it('preserves id/sid/order/meta across the conversion', () => {
    const d = doc(para('#', { id: 'gid', sid: 'ab12', order: 7, meta: { k: 1 } }));
    const { state } = type(d, caretAt(d, 0, 1), ' ');
    const h = blockAt(state.doc, 0);
    expect(h.attrs.id).toBe('gid');
    expect(h.attrs.sid).toBe('ab12');
    expect(h.attrs.order).toBe(7);
    expect(h.attrs.meta).toEqual({ k: 1 });
  });

  it('bolds text typed into a heading made by "# " (invariant runs on the applied tr)', () => {
    const d = doc(para('#'));
    const { state } = type(d, caretAt(d, 0, 1), ' ');
    // Now type a character into the fresh heading; the pipeline forces bold.
    const caret = caretAt(state.doc, 0, 0);
    const typed = state.apply(state.tr.insertText('x', caret));
    const h = blockAt(typed.doc, 0);
    expect(h.textContent).toBe('x');
    expect(allBold(h)).toBe(true);
  });

  it('does not fire from a non-paragraph block (triggers are paragraph-scoped)', () => {
    const d = doc(bullet('-'));
    const { state, handled } = type(d, caretAt(d, 0, 1), ' ');
    expect(handled).toBe(false);
    expect(blockAt(state.doc, 0).type.name).toBe('bulletItem');
  });

  it('does not fire for a non-space character', () => {
    const d = doc(para('#'));
    const { handled } = type(d, caretAt(d, 0, 1), 'x');
    expect(handled).toBe(false);
  });

  it('does not fire when a range is selected rather than a collapsed caret', () => {
    const d = doc(para('#'));
    const plugin = inputTriggerPlugin(registry);
    const stateWithRange = EditorState.create({
      schema,
      doc: d,
      selection: TextSelection.create(d, caretAt(d, 0, 0), caretAt(d, 0, 1)),
      plugins: [invariantPipeline(registry)],
    });
    const view = { state: stateWithRange, dispatch() {} };
    const handled = plugin.props.handleTextInput!.call(
      plugin,
      view as unknown as EditorView,
      caretAt(d, 0, 0),
      caretAt(d, 0, 1),
      ' ',
      () => view.state.tr,
    );
    expect(Boolean(handled)).toBe(false);
  });
});
