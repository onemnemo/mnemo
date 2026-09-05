// @vitest-environment node

/**
 * The to-do toggle: the keyboard's only way to a checkbox, so what it declines
 * matters as much as what it does. Ctrl/Cmd+Enter is the soft break everywhere
 * else, and the chord only reaches the break because this command hands it back.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { isChecklistItemChecked, toggleChecklistItem } from './checklist';

const { schema } = createEditorSchema();

const line = (text?: string): PMNode =>
  schema.nodes.line.create(null, text ? schema.text(text) : null);
const item = (text: string, checked: boolean): PMNode =>
  schema.nodes.checklistItem.create({ checked, sid: 'c1', id: 'c1' }, line(text));
const para = (text: string): PMNode => schema.nodes.paragraph.create(null, line(text));
const docOf = (...blocks: PMNode[]): PMNode => schema.nodes.doc.create(null, blocks);

function run(document: PMNode, command: Command, from: number, to = from) {
  const state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, from, to),
  });
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { state: next, handled };
}

describe('toggleChecklistItem', () => {
  it('checks the item the caret is in, and unchecks it again', () => {
    const document = docOf(item('buy milk', false));
    const checked = run(document, toggleChecklistItem, 4).state;
    expect(checked.doc.child(0).attrs.checked).toBe(true);
    expect(run(checked.doc, toggleChecklistItem, 4).state.doc.child(0).attrs.checked).toBe(false);
  });

  it('keeps the identity and the text, since only the checked state changed', () => {
    const document = docOf(item('buy milk', false));
    const { state } = run(document, toggleChecklistItem, 4);
    const block = state.doc.child(0);
    expect(block.attrs.sid).toBe('c1');
    expect(block.textContent).toBe('buy milk');
  });

  it('answers a range inside the item as readily as a caret', () => {
    const document = docOf(item('buy milk', false));
    const { handled, state } = run(document, toggleChecklistItem, 2, 5);
    expect(handled).toBe(true);
    expect(state.doc.child(0).attrs.checked).toBe(true);
  });

  it('declines outside a to-do, so the chord keeps its other meaning', () => {
    const document = docOf(para('plain'));
    const { handled, state } = run(document, toggleChecklistItem, 3);
    expect(handled).toBe(false);
    expect(state.doc.eq(document)).toBe(true);
  });
});

describe('isChecklistItemChecked', () => {
  it('reads the item at the caret, and answers false everywhere else', () => {
    const checkedDoc = docOf(item('done', true));
    const state = EditorState.create({
      schema,
      doc: checkedDoc,
      selection: TextSelection.create(checkedDoc, 4),
    });
    expect(isChecklistItemChecked(state)).toBe(true);

    const plain = docOf(para('plain'));
    expect(
      isChecklistItemChecked(
        EditorState.create({ schema, doc: plain, selection: TextSelection.create(plain, 3) }),
      ),
    ).toBe(false);
  });
});
