/**
 * `toggleFormat`, the custom toggle behind every mark toolbar/keymap surface.
 * Tested against real editor states built through the mapper, so the decision
 * rule, swatch replace and sub/sup exclusion are exercised on the same document
 * shape the app produces.
 */

import { describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { Mark, MarkType, Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { defaultTextStyle, type Block, type BlockPayload, type BlockType, type TextStyle } from '../../model/types';
import { clearSwatch, toggleFormat } from './commands';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

type SpanStyle = Partial<TextStyle>;
type SpanSpec = { text: string; style?: SpanStyle };

function blockOf(type: BlockType, spans: Block['spans'], payload: BlockPayload): Block {
  return { id: 'id-1', sid: 's0001', type, spans, payload, meta: {}, order: 0, children: null };
}

function textBlock(spans: SpanSpec[]): Block {
  return blockOf(
    'Text',
    spans.map((s) => ({ kind: 'text', text: s.text, style: { ...defaultTextStyle, ...s.style } })),
    { kind: 'empty' },
  );
}

function stateOf(block: Block): EditorState {
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema });
}

/** Selects the entire inline content of the single text block. */
function selectAll(state: EditorState): EditorState {
  let from = -1;
  let to = -1;
  state.doc.descendants((node, pos) => {
    if (node.isText || node.isAtom) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
    return !node.isText && !node.isAtom;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

/** Caret inside the first inline run, one position in. */
function caretInFirstRun(state: EditorState): EditorState {
  let pos = -1;
  state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText) pos = at + 1;
    return pos < 0;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/** Applies a command and returns the resulting document (or null if it declined). */
function run(state: EditorState, command: ReturnType<typeof toggleFormat>): PMNode | null {
  const dispatch = vi.fn<(tr: Transaction) => void>();
  const ok = command(state, dispatch);
  if (!ok) return null;
  return dispatch.mock.calls[0]?.[0].doc ?? state.doc;
}

/** Applies a command and returns the resulting transaction's stored marks. */
function runStored(state: EditorState, command: ReturnType<typeof toggleFormat>): readonly Mark[] | null {
  const dispatch = vi.fn<(tr: Transaction) => void>();
  const ok = command(state, dispatch);
  if (!ok) return null;
  return dispatch.mock.calls[0]?.[0].storedMarks ?? null;
}

function textNodes(doc: PMNode): PMNode[] {
  const out: PMNode[] = [];
  doc.descendants((node) => {
    if (node.isText) out.push(node);
    return true;
  });
  return out;
}

function hasMark(node: PMNode, type: MarkType): boolean {
  return !!type.isInSet(node.marks);
}

function tokenOf(node: PMNode, type: MarkType): string | null {
  const mark = node.marks.find((m) => m.type === type);
  return mark && typeof mark.attrs.token === 'string' ? mark.attrs.token : null;
}

describe('flag toggle, the all-have decision rule', () => {
  it('sets the mark across a plain range', () => {
    const doc = run(selectAll(stateOf(textBlock([{ text: 'abcd' }]))), toggleFormat('bold'));
    expect(doc).not.toBeNull();
    expect(textNodes(doc!).every((n) => hasMark(n, schema.marks.strong))).toBe(true);
  });

  it('clears the mark when the whole range already has it', () => {
    const doc = run(selectAll(stateOf(textBlock([{ text: 'abcd', style: { bold: true } }]))), toggleFormat('bold'));
    expect(textNodes(doc!).some((n) => hasMark(n, schema.marks.strong))).toBe(false);
  });

  it('SETS a half-formatted range rather than stripping the formatted part', () => {
    // The divergence from stock `toggleMark`, which would clear here.
    const state = selectAll(stateOf(textBlock([{ text: 'ab', style: { bold: true } }, { text: 'cd' }])));
    const doc = run(state, toggleFormat('bold'));
    expect(textNodes(doc!).every((n) => hasMark(n, schema.marks.strong))).toBe(true);
  });
});

describe('swatch toggle, token-aware replace', () => {
  it('applies the given token across a plain range', () => {
    const doc = run(selectAll(stateOf(textBlock([{ text: 'abcd' }]))), toggleFormat('backgroundColor', 'swatch5'));
    expect(textNodes(doc!).every((n) => tokenOf(n, schema.marks.bgSwatch) === 'swatch5')).toBe(true);
  });

  it('REPLACES a different token rather than clearing the colour', () => {
    const state = selectAll(stateOf(textBlock([{ text: 'abcd', style: { backgroundColor: 'swatch3' } }])));
    const doc = run(state, toggleFormat('backgroundColor', 'swatch5'));
    const nodes = textNodes(doc!);
    expect(nodes.every((n) => tokenOf(n, schema.marks.bgSwatch) === 'swatch5')).toBe(true);
    // No trace of the old token survives.
    expect(nodes.some((n) => tokenOf(n, schema.marks.bgSwatch) === 'swatch3')).toBe(false);
  });

  it('clears when the whole range already carries the same token', () => {
    const state = selectAll(stateOf(textBlock([{ text: 'abcd', style: { backgroundColor: 'swatch5' } }])));
    const doc = run(state, toggleFormat('backgroundColor', 'swatch5'));
    expect(textNodes(doc!).some((n) => hasMark(n, schema.marks.bgSwatch))).toBe(false);
  });

  it('refuses without a token', () => {
    const dispatch = vi.fn();
    expect(toggleFormat('backgroundColor')(selectAll(stateOf(textBlock([{ text: 'ab' }]))), dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('sub/sup exclusion, enforced in the command, not the schema', () => {
  it('setting subscript clears superscript across the range', () => {
    const state = selectAll(stateOf(textBlock([{ text: 'abcd', style: { superscript: true } }])));
    const doc = run(state, toggleFormat('subscript'));
    const nodes = textNodes(doc!);
    expect(nodes.every((n) => hasMark(n, schema.marks.sub))).toBe(true);
    expect(nodes.some((n) => hasMark(n, schema.marks.sup))).toBe(false);
  });

  it('the two never both survive a set, the second wins', () => {
    // Apply sub, then sup, threading the document forward.
    const afterSub = run(selectAll(stateOf(textBlock([{ text: 'abcd' }]))), toggleFormat('subscript'))!;
    const stateWithSub = EditorState.create({ doc: afterSub, schema });
    const doc = run(selectAll(stateWithSub), toggleFormat('superscript'))!;
    const nodes = textNodes(doc);
    expect(nodes.every((n) => hasMark(n, schema.marks.sup))).toBe(true);
    expect(nodes.some((n) => hasMark(n, schema.marks.sub))).toBe(false);
  });

  it('clearing subscript leaves a pre-existing superscript alone', () => {
    // A both-true span exists on the wire; clearing one must not touch the other.
    const state = selectAll(stateOf(textBlock([{ text: 'abcd', style: { subscript: true, superscript: true } }])));
    const doc = run(state, toggleFormat('subscript'));
    const nodes = textNodes(doc!);
    expect(nodes.some((n) => hasMark(n, schema.marks.sub))).toBe(false);
    expect(nodes.every((n) => hasMark(n, schema.marks.sup))).toBe(true);
  });
});

describe('collapsed caret, sticky typing via storedMarks', () => {
  it('arms the mark for the next character', () => {
    const stored = runStored(caretInFirstRun(stateOf(textBlock([{ text: 'abcd' }]))), toggleFormat('bold'));
    expect(stored).not.toBeNull();
    expect(schema.marks.strong.isInSet(stored!)).toBeTruthy();
  });

  it('a second toggle disarms it', () => {
    const state = caretInFirstRun(stateOf(textBlock([{ text: 'abcd', style: { bold: true } }])));
    const stored = runStored(state, toggleFormat('bold'));
    // Inherited bold is overridden to off, so the next character is unbold.
    expect(stored).not.toBeNull();
    expect(schema.marks.strong.isInSet(stored!)).toBeFalsy();
  });

  it('arming subscript disarms superscript', () => {
    const state = caretInFirstRun(stateOf(textBlock([{ text: 'abcd', style: { superscript: true } }])));
    const stored = runStored(state, toggleFormat('subscript'));
    expect(schema.marks.sub.isInSet(stored!)).toBeTruthy();
    expect(schema.marks.sup.isInSet(stored!)).toBeFalsy();
  });

  it('arms a swatch token on a plain caret', () => {
    const first = runStored(caretInFirstRun(stateOf(textBlock([{ text: 'ab' }]))), toggleFormat('backgroundColor', 'swatch3'));
    const mark = first!.find((m) => m.type === schema.marks.bgSwatch);
    expect(mark?.attrs.token).toBe('swatch3');
  });

  it('replaces an inherited swatch token rather than clearing it', () => {
    // Caret sits in swatch3 text; arming swatch5 must swap the token, the same
    // token-aware way a range replace does, not read "a swatch is present" and
    // disarm.
    const state = caretInFirstRun(stateOf(textBlock([{ text: 'abcd', style: { backgroundColor: 'swatch3' } }])));
    const stored = runStored(state, toggleFormat('backgroundColor', 'swatch5'));
    const mark = stored!.find((m) => m.type === schema.marks.bgSwatch);
    expect(mark?.attrs.token).toBe('swatch5');
  });

  it('disarms a swatch when the inherited token matches', () => {
    const state = caretInFirstRun(stateOf(textBlock([{ text: 'abcd', style: { backgroundColor: 'swatch5' } }])));
    const stored = runStored(state, toggleFormat('backgroundColor', 'swatch5'));
    expect(stored!.some((m) => m.type === schema.marks.bgSwatch)).toBe(false);
  });
});

describe('clearSwatch, the picker\'s "default"/"none" cell', () => {
  it('removes the mark across a coloured range', () => {
    const state = selectAll(stateOf(textBlock([{ text: 'abcd', style: { backgroundColor: 'swatch5' } }])));
    const doc = run(state, clearSwatch('backgroundColor'));
    expect(textNodes(doc!).some((n) => hasMark(n, schema.marks.bgSwatch))).toBe(false);
  });

  it('refuses a plain range, nothing to clear', () => {
    const dispatch = vi.fn();
    expect(clearSwatch('backgroundColor')(selectAll(stateOf(textBlock([{ text: 'ab' }]))), dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('disarms an inherited stored token at a collapsed caret', () => {
    const state = caretInFirstRun(stateOf(textBlock([{ text: 'abcd', style: { foregroundColor: 'swatch3' } }])));
    const stored = runStored(state, clearSwatch('foregroundColor'));
    expect(stored!.some((m) => m.type === schema.marks.fgSwatch)).toBe(false);
  });

  it('only clears the family it names, leaving the other colour alone', () => {
    const state = selectAll(
      stateOf(textBlock([{ text: 'abcd', style: { backgroundColor: 'swatch5', foregroundColor: 'swatch3' } }])),
    );
    const doc = run(state, clearSwatch('backgroundColor'));
    const nodes = textNodes(doc!);
    expect(nodes.some((n) => hasMark(n, schema.marks.bgSwatch))).toBe(false);
    expect(nodes.every((n) => tokenOf(n, schema.marks.fgSwatch) === 'swatch3')).toBe(true);
  });
});

describe('availability', () => {
  it('refuses inside a code block, whose content admits no marks', () => {
    const state = caretInFirstRun(stateOf(blockOf('Code', [], { kind: 'code', language: 'text', source: 'hi' })));
    expect(toggleFormat('bold')(state, vi.fn())).toBe(false);
  });

  it('reports availability on a text range without a dispatch', () => {
    expect(toggleFormat('bold')(selectAll(stateOf(textBlock([{ text: 'ab' }]))))).toBe(true);
  });
});
