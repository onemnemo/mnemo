/**
 * `applyLink`/`removeLink`, and the readouts a link control needs
 * (`currentLinkHref`/`isLinkActive`/`canEditLink`). Tested against real editor
 * states built through the mapper, the same convention `commands.test.ts`
 * uses for the toggled marks, since the wire format stores `linkUrl` per span
 * and the mapper turns it into the `link` mark with no reconciliation of its
 * own.
 */

import { describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { defaultTextStyle, type Block, type BlockPayload, type BlockType, type TextStyle } from '../../model/types';
import { applyLink, canEditLink, currentLinkHref, isLinkActive, removeLink } from './link-commands';

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

function stateOf(...blocks: Block[]): EditorState {
  const result = mapper.toDoc(blocks.map((b, i) => ({ ...b, sid: `s000${String(i)}`, order: i })));
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

/** Caret `offset` characters into the first inline run. */
function caretInFirstRun(state: EditorState, offset = 1): EditorState {
  let pos = -1;
  state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText) pos = at + offset;
    return pos < 0;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function textNodes(doc: PMNode): PMNode[] {
  const out: PMNode[] = [];
  doc.descendants((node) => {
    if (node.isText) out.push(node);
    return true;
  });
  return out;
}

function hrefOf(node: PMNode): string | null {
  const mark = node.marks.find((m) => m.type === schema.marks.link);
  return typeof mark?.attrs.href === 'string' ? mark.attrs.href : null;
}

/** Applies a command and returns the resulting document (or null if it declined). */
function run(state: EditorState, command: ReturnType<typeof applyLink> | ReturnType<typeof removeLink>): PMNode | null {
  const dispatch = vi.fn<(tr: Transaction) => void>();
  const ok = command(state, dispatch);
  if (!ok) return null;
  return dispatch.mock.calls[0]?.[0].doc ?? state.doc;
}

describe('applyLink over a selection', () => {
  it('sets the mark across a plain range', () => {
    const doc = run(selectAll(stateOf(textBlock([{ text: 'abcd' }]))), applyLink('https://example.com'));
    expect(doc).not.toBeNull();
    expect(textNodes(doc!).every((n) => hrefOf(n) === 'https://example.com')).toBe(true);
  });

  it('retargets a range that already carries a different href', () => {
    const state = selectAll(stateOf(textBlock([{ text: 'abcd', style: { linkUrl: 'https://old.example' } }])));
    const doc = run(state, applyLink('https://new.example'));
    const nodes = textNodes(doc!);
    expect(nodes.every((n) => hrefOf(n) === 'https://new.example')).toBe(true);
    expect(nodes.some((n) => hrefOf(n) === 'https://old.example')).toBe(false);
  });

  it('refuses an unsafe scheme', () => {
    const dispatch = vi.fn();
    const ok = applyLink('javascript:alert(1)')(selectAll(stateOf(textBlock([{ text: 'ab' }]))), dispatch);
    expect(ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('accepts a scheme-less relative href', () => {
    const doc = run(selectAll(stateOf(textBlock([{ text: 'ab' }]))), applyLink('/notes/abc'));
    expect(doc).not.toBeNull();
    expect(textNodes(doc!).every((n) => hrefOf(n) === '/notes/abc')).toBe(true);
  });
});

describe('applyLink at a collapsed caret', () => {
  it('refuses a caret that is not inside a link', () => {
    const dispatch = vi.fn();
    const ok = applyLink('https://example.com')(caretInFirstRun(stateOf(textBlock([{ text: 'abcd' }]))), dispatch);
    expect(ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('retargets the whole link the caret sits inside', () => {
    const state = caretInFirstRun(
      stateOf(textBlock([{ text: 'abcd', style: { linkUrl: 'https://old.example' } }])),
      2,
    );
    const doc = run(state, applyLink('https://new.example'));
    expect(doc).not.toBeNull();
    // The full run retargets, not just the half after the caret.
    expect(textNodes(doc!).every((n) => hrefOf(n) === 'https://new.example')).toBe(true);
  });

  it('grows the retarget across adjacent runs sharing the same link', () => {
    const state = caretInFirstRun(
      stateOf(
        textBlock([
          { text: 'ab', style: { linkUrl: 'https://old.example' } },
          { text: 'cd', style: { linkUrl: 'https://old.example' } },
        ]),
      ),
      1,
    );
    const doc = run(state, applyLink('https://new.example'));
    expect(textNodes(doc!).every((n) => hrefOf(n) === 'https://new.example')).toBe(true);
  });

  it('does not spill into an adjacent run carrying a different link', () => {
    const state = caretInFirstRun(
      stateOf(
        textBlock([
          { text: 'ab', style: { linkUrl: 'https://a.example' } },
          { text: 'cd', style: { linkUrl: 'https://b.example' } },
        ]),
      ),
      1,
    );
    const doc = run(state, applyLink('https://new.example'));
    const [first, second] = textNodes(doc!);
    expect(hrefOf(first)).toBe('https://new.example');
    expect(hrefOf(second)).toBe('https://b.example');
  });
});

describe('removeLink over a selection', () => {
  it('removes the mark across a linked range', () => {
    const state = selectAll(stateOf(textBlock([{ text: 'abcd', style: { linkUrl: 'https://example.com' } }])));
    const doc = run(state, removeLink());
    expect(textNodes(doc!).every((n) => hrefOf(n) === null)).toBe(true);
  });

  it('refuses a range with no link in it', () => {
    const dispatch = vi.fn();
    const ok = removeLink()(selectAll(stateOf(textBlock([{ text: 'ab' }]))), dispatch);
    expect(ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('removeLink at a collapsed caret', () => {
  it('removes the whole link the caret sits inside', () => {
    const state = caretInFirstRun(
      stateOf(textBlock([{ text: 'abcd', style: { linkUrl: 'https://example.com' } }])),
      2,
    );
    const doc = run(state, removeLink());
    expect(doc).not.toBeNull();
    expect(textNodes(doc!).every((n) => hrefOf(n) === null)).toBe(true);
  });

  it('refuses a caret that is not inside a link', () => {
    const dispatch = vi.fn();
    const ok = removeLink()(caretInFirstRun(stateOf(textBlock([{ text: 'abcd' }]))), dispatch);
    expect(ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('currentLinkHref / isLinkActive', () => {
  it('reads the uniform href across a linked range', () => {
    const state = selectAll(stateOf(textBlock([{ text: 'abcd', style: { linkUrl: 'https://example.com' } }])));
    expect(currentLinkHref(state)).toBe('https://example.com');
    expect(isLinkActive(state)).toBe(true);
  });

  it('reads null across a plain range', () => {
    const state = selectAll(stateOf(textBlock([{ text: 'abcd' }])));
    expect(currentLinkHref(state)).toBeNull();
    expect(isLinkActive(state)).toBe(false);
  });

  it('reads null across a selection spanning two different links', () => {
    const state = selectAll(
      stateOf(
        textBlock([
          { text: 'ab', style: { linkUrl: 'https://a.example' } },
          { text: 'cd', style: { linkUrl: 'https://b.example' } },
        ]),
      ),
    );
    expect(currentLinkHref(state)).toBeNull();
    expect(isLinkActive(state)).toBe(false);
  });

  it('reads the href at a caret inside a link', () => {
    const state = caretInFirstRun(
      stateOf(textBlock([{ text: 'abcd', style: { linkUrl: 'https://example.com' } }])),
      2,
    );
    expect(currentLinkHref(state)).toBe('https://example.com');
  });

  it('reads null at a caret outside any link', () => {
    const state = caretInFirstRun(stateOf(textBlock([{ text: 'abcd' }])));
    expect(currentLinkHref(state)).toBeNull();
  });
});

describe('canEditLink', () => {
  it('allows a plain writable range, there is text to link', () => {
    expect(canEditLink(selectAll(stateOf(textBlock([{ text: 'ab' }]))))).toBe(true);
  });

  it('allows a caret already inside a link', () => {
    const state = caretInFirstRun(
      stateOf(textBlock([{ text: 'abcd', style: { linkUrl: 'https://example.com' } }])),
      2,
    );
    expect(canEditLink(state)).toBe(true);
  });

  it('refuses a caret with no link and no selection to grow into one', () => {
    expect(canEditLink(caretInFirstRun(stateOf(textBlock([{ text: 'abcd' }]))))).toBe(false);
  });

  it('refuses inside a code block, whose content admits no marks', () => {
    const state = caretInFirstRun(stateOf(blockOf('Code', [], { kind: 'code', language: 'text', source: 'hi' })));
    expect(canEditLink(state)).toBe(false);
  });
});
