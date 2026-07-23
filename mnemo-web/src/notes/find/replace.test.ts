import { describe, expect, it } from 'vitest';
import type { EditorState } from 'prosemirror-state';
import { buildNoteEditState } from '../edit/build-edit-state';
import { undo } from '../editor/history';
import { projectDocument } from '../editor/projection/document';
import { defaultTextStyle, type Block, type InlineSpan } from '../model/types';
import { buildReplaceAll, buildReplaceOne } from './replace';
import { searchDocument, type FindOptions } from './search';

let nextSid = 0;
function blockOf(over: Partial<Block> = {}): Block {
  nextSid += 1;
  return {
    id: `id-${String(nextSid)}`,
    sid: `s${String(nextSid).padStart(4, '0')}`,
    type: 'Text',
    spans: [{ kind: 'text', text: '', style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...over,
  };
}

const text = (t: string, over: Partial<InlineSpan> = {}): InlineSpan => ({
  kind: 'text',
  text: t,
  style: { ...defaultTextStyle },
  ...over,
} as InlineSpan);

const equation = (latex: string): InlineSpan => ({ kind: 'equation', latex, style: { ...defaultTextStyle } });

const INSENSITIVE: FindOptions = { caseSensitive: false, wholeWord: false };

/** Build an editable state (history + find plugins wired) from blocks. */
function editStateOf(blocks: readonly Block[]): { state: EditorState; registry: ReturnType<typeof build>['registry'] } {
  const built = build(blocks);
  return { state: built.state, registry: built.registry };
}
function build(blocks: readonly Block[]) {
  const result = buildNoteEditState(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result;
}

function docText(state: EditorState, registry: ReturnType<typeof build>['registry']): string {
  return projectDocument(state.doc, registry).text;
}

describe('buildReplaceOne', () => {
  it('replaces one match, leaving the rest of the block intact', () => {
    const { state, registry } = editStateOf([blockOf({ spans: [text('foo bar foo')] })]);
    const match = searchDocument(projectDocument(state.doc, registry), 'foo', INSENSITIVE, state.doc)[0];
    const tr = buildReplaceOne(state, match, 'baz');
    expect(tr).not.toBeNull();
    const after = state.apply(tr!);
    expect(docText(after, registry)).toBe('baz bar foo\n');
  });

  it('deletes the match when the replacement is empty', () => {
    const { state, registry } = editStateOf([blockOf({ spans: [text('remove me please')] })]);
    const match = searchDocument(projectDocument(state.doc, registry), 'me ', INSENSITIVE, state.doc)[0];
    const after = state.apply(buildReplaceOne(state, match, '')!);
    expect(docText(after, registry)).toBe('remove please\n');
  });

  it('preserves the formatting of the matched text', () => {
    const { state, registry } = editStateOf([
      blockOf({ spans: [text('important', { style: { ...defaultTextStyle, bold: true } })] }),
    ]);
    const match = searchDocument(projectDocument(state.doc, registry), 'important', INSENSITIVE, state.doc)[0];
    const before = state.doc.resolve(match.from + 1).marks().map((m) => m.type.name);
    expect(before.length).toBeGreaterThan(0);
    const after = state.apply(buildReplaceOne(state, match, 'crucial')!);
    const marks = after.doc.resolve(match.from + 1).marks().map((m) => m.type.name);
    expect(marks).toEqual(before);
  });

  it('refuses a match whose exact text is no longer where it was', () => {
    const { state, registry } = editStateOf([blockOf({ spans: [text('foo bar')] })]);
    const match = searchDocument(projectDocument(state.doc, registry), 'bar', INSENSITIVE, state.doc)[0];
    // The document moves out from under the match: its range no longer holds
    // "bar", so the replace must refuse rather than overwrite the wrong span.
    const moved = state.apply(state.tr.insertText('XX', 1));
    expect(buildReplaceOne(moved, match, 'baz')).toBeNull();
  });

  it('is a single undo step', () => {
    const { state, registry } = editStateOf([blockOf({ spans: [text('foo foo foo')] })]);
    const match = searchDocument(projectDocument(state.doc, registry), 'foo', INSENSITIVE, state.doc)[1];
    const after = state.apply(buildReplaceOne(state, match, 'baz')!);
    expect(docText(after, registry)).toBe('foo baz foo\n');

    let undone: EditorState | null = null;
    undo(after, (tr) => {
      undone = after.apply(tr);
    });
    expect(undone).not.toBeNull();
    expect(docText(undone!, registry)).toBe('foo foo foo\n');
  });

  it('rewrites block-equation LaTeX through its attribute', () => {
    const { state, registry } = editStateOf([
      blockOf({ type: 'Equation', spans: [], payload: { kind: 'equation', latex: 'a + b + a' } }),
    ]);
    const match = searchDocument(
      projectDocument(state.doc, registry),
      'a',
      { caseSensitive: true, wholeWord: false },
      state.doc,
    )[0];
    const after = state.apply(buildReplaceOne(state, match, 'z')!);
    expect(String(after.doc.nodeAt(match.from)?.attrs.latex)).toBe('z + b + a');
  });
});

describe('buildReplaceAll', () => {
  it('replaces every match across blocks in one transaction', () => {
    const { state, registry } = editStateOf([
      blockOf({ spans: [text('cat dog cat')] }),
      blockOf({ type: 'Quote', spans: [text('cat')] }),
    ]);
    const result = buildReplaceAll(state, registry, 'cat', INSENSITIVE, 'fox');
    expect(result?.count).toBe(3);
    const after = state.apply(result!.tr);
    expect(docText(after, registry)).toBe('fox dog fox\nfox\n');
  });

  it('is one undo step for the whole batch', () => {
    const { state, registry } = editStateOf([
      blockOf({ spans: [text('one one')] }),
      blockOf({ spans: [text('one')] }),
    ]);
    const after = state.apply(buildReplaceAll(state, registry, 'one', INSENSITIVE, 'two')!.tr);
    expect(docText(after, registry)).toBe('two two\ntwo\n');

    let undone: EditorState | null = null;
    undo(after, (tr) => {
      undone = after.apply(tr);
    });
    expect(docText(undone!, registry)).toBe('one one\none\n');
  });

  it('applies overlapping-position-safe replacements when the replacement is longer', () => {
    // Descending application: a longer replacement earlier in the block must not
    // shift the offsets of a later match in the same block.
    const { state, registry } = editStateOf([blockOf({ spans: [text('x x x')] })]);
    const after = state.apply(buildReplaceAll(state, registry, 'x', INSENSITIVE, 'yyy')!.tr);
    expect(docText(after, registry)).toBe('yyy yyy yyy\n');
  });

  it('returns null when there is nothing to replace', () => {
    const { state, registry } = editStateOf([blockOf({ spans: [text('nothing here')] })]);
    expect(buildReplaceAll(state, registry, 'absent', INSENSITIVE, 'x')).toBeNull();
  });

  it('replaces only real text and counts only what it wrote, never an inline atom', () => {
    // The inline equation projects its LaTeX "x" into the text, but there is no
    // editable range inside a rendered atom: replace must touch only the prose
    // "x" and the reported count must not include the atom.
    const { state, registry } = editStateOf([blockOf({ spans: [text('x '), equation('x')] })]);
    const result = buildReplaceAll(state, registry, 'x', INSENSITIVE, 'y');
    expect(result?.count).toBe(1);
    const after = state.apply(result!.tr);
    // The prose became "y "; the equation atom still carries LaTeX "x".
    expect(after.doc.textBetween(0, after.doc.content.size, '\n')).toContain('y');
    let atomLatex: string | null = null;
    after.doc.descendants((node) => {
      if (node.type.name === 'equationSpan') atomLatex = String(node.attrs.latex);
    });
    expect(atomLatex).toBe('x');
  });
});
