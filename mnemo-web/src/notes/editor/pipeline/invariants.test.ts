// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Mark, Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import type { BlockRegistry, InvariantEntry } from '../registry/build';
import { changedRanges, invariantPipeline } from './invariants';

const { schema, registry } = createEditorSchema();

function line(text?: string, marks?: readonly Mark[]): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text, marks) : null);
}
function paragraph(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function heading(level: number, text?: string, marks?: readonly Mark[]): PMNode {
  return schema.nodes.heading.create({ level }, line(text, marks));
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

/** A registry carrying only invariants, all `invariantPipeline` reads. */
function fakeRegistry(invariants: InvariantEntry[]): BlockRegistry {
  return { invariants } as unknown as BlockRegistry;
}

function stateWith(invariants: InvariantEntry[], document: PMNode): EditorState {
  return EditorState.create({
    schema,
    doc: document,
    plugins: [invariantPipeline(fakeRegistry(invariants))],
  });
}

/** Whether every inline text node in a block's line carries `markName`. */
function lineAllMarked(block: PMNode, markName: string): boolean {
  const lineNode = block.firstChild;
  if (!lineNode || lineNode.content.size === 0) return false;
  let all = true;
  lineNode.forEach((child) => {
    if (child.isText && !child.marks.some((m) => m.type.name === markName)) all = false;
  });
  return all;
}

describe('invariant pipeline engine', () => {
  it('does not react to its own appended transaction (bounded, one pass)', () => {
    let calls = 0;
    // Non-idempotent on purpose: it inserts a character every time it runs, so
    // without the self-trigger guard ProseMirror's append loop would never stop.
    const noisy: InvariantEntry = {
      id: 'test.noisy',
      order: 0,
      nodeName: 'paragraph',
      apply(ctx) {
        calls += 1;
        ctx.tr.insertText('!', 1);
        return ctx.tr;
      },
    };
    let state = stateWith([noisy], doc(paragraph('a')));
    state = state.apply(state.tr.insertText('b', 2));
    expect(calls).toBe(1);
    // Exactly one injected '!', proof the pipeline ran once and then stopped.
    expect(state.doc.firstChild!.textContent.split('!').length - 1).toBe(1);
  });

  it('skips an invariant whose node type is not in any changed range', () => {
    let calls = 0;
    const headingsOnly: InvariantEntry = {
      id: 'test.headingsOnly',
      order: 0,
      nodeName: 'heading',
      apply() {
        calls += 1;
        return null;
      },
    };
    // Document has no heading, so editing the paragraph must not run it.
    let state = stateWith([headingsOnly], doc(paragraph('a')));
    state = state.apply(state.tr.insertText('b', 2));
    expect(calls).toBe(0);
  });

  it('runs invariants in registry order', () => {
    const seen: string[] = [];
    const mk = (id: string, order: number): InvariantEntry => ({
      id,
      order,
      nodeName: 'paragraph',
      apply() {
        seen.push(id);
        return null;
      },
    });
    // Passed pre-sorted, as the registry hands them over; the engine iterates in
    // array order and does not re-sort.
    let state = stateWith([mk('first', 0), mk('second', 10)], doc(paragraph('a')));
    state = state.apply(state.tr.insertText('b', 2));
    expect(seen).toEqual(['first', 'second']);
  });

  it('does nothing when no transaction changed the document', () => {
    let calls = 0;
    const inv: InvariantEntry = {
      id: 'test.any',
      order: 0,
      nodeName: 'paragraph',
      apply() {
        calls += 1;
        return null;
      },
    };
    let state = stateWith([inv], doc(paragraph('a')));
    // A pure selection change is not a document change.
    state = state.apply(state.tr.setSelection(state.selection));
    expect(calls).toBe(0);
  });
});

describe('changedRanges', () => {
  it('reports the touched range in the final document space', () => {
    const base = EditorState.create({ schema, doc: doc(paragraph('abc')) });
    const tr = base.tr.insertText('X', 2);
    const ranges = changedRanges([tr]);
    expect(ranges).toHaveLength(1);
    // The insert sits inside the paragraph's line; the reported range covers it.
    expect(ranges[0].from).toBeLessThanOrEqual(2);
    expect(ranges[0].to).toBeGreaterThanOrEqual(2);
  });
});

describe('heading-forced-bold invariant', () => {
  it('forces bold when a paragraph is converted to a heading', () => {
    let state = EditorState.create({
      schema,
      doc: doc(paragraph('title')),
      plugins: [invariantPipeline(registry)],
    });
    state = state.apply(state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 1 }));
    const h = state.doc.firstChild!;
    expect(h.type.name).toBe('heading');
    expect(lineAllMarked(h, 'strong')).toBe(true);
  });

  it('forces bold onto text typed into a heading', () => {
    let state = EditorState.create({
      schema,
      doc: doc(heading(2, 'hi')),
      plugins: [invariantPipeline(registry)],
    });
    // Type a character at the end of the heading's text (pos 2 opens the line's
    // content, "hi" is 2 chars, so the end is pos 4).
    state = state.apply(state.tr.insertText('!', 4));
    const h = state.doc.firstChild!;
    expect(h.textContent).toBe('hi!');
    expect(lineAllMarked(h, 'strong')).toBe(true);
  });

  it('is idempotent, an already-bold heading produces no further change', () => {
    const strong = schema.marks.strong.create();
    let state = EditorState.create({
      schema,
      doc: doc(heading(1, 'bold', [strong])),
      plugins: [invariantPipeline(registry)],
    });
    // A no-op-shaped edit (delete then reinsert same char) keeps the text bold
    // and must not spin or double-apply.
    const before = state.doc;
    state = state.apply(state.tr.insertText('x', 5).delete(5, 6));
    expect(lineAllMarked(state.doc.firstChild!, 'strong')).toBe(true);
    expect(state.doc.eq(before)).toBe(true);
  });

  it('does not strip bold from a plain paragraph (leaving a heading is the command\'s job)', () => {
    const strong = schema.marks.strong.create();
    let state = EditorState.create({
      schema,
      doc: doc(paragraph(undefined)),
      plugins: [invariantPipeline(registry)],
    });
    // Insert already-bold text into a paragraph; the invariant must leave it be.
    state = state.apply(state.tr.insertText('x', 2).addMark(2, 3, strong));
    const p = state.doc.firstChild!;
    expect(p.type.name).toBe('paragraph');
    expect(lineAllMarked(p, 'strong')).toBe(true);
  });
});
