// @vitest-environment node
/**
 * `fromDoc`'s per-block cache: an autosave that only touched one block must not
 * pay to re-walk and re-serialize every other block in the note. Proven at the
 * `Block` reference level, not by timing, since PM's node identity is exactly
 * what the cache keys on.
 */
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { createEditorSchema } from '../schema';
import { createDocumentMapper } from './document';
import { block, span } from './fixtures';

function twoBlockState() {
  const { schema, registry } = createEditorSchema();
  const mapper = createDocumentMapper(schema, registry);
  const built = mapper.toDoc([block('Text', [span('one')]), block('Text', [span('two')])]);
  if (!built.ok) throw new Error('fixture failed to build');
  return { mapper, state: EditorState.create({ schema, doc: built.doc }) };
}

describe('fromDoc block cache', () => {
  it('returns the same Block reference for a block an edit never touched', () => {
    const { mapper, state } = twoBlockState();
    const before = mapper.fromDoc(state.doc);

    // Edit only inside the second block's text.
    const secondBlockStart = state.doc.child(0).nodeSize;
    const next = state.apply(state.tr.insertText('!', secondBlockStart + 2));
    const after = mapper.fromDoc(next.doc);

    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].spans.map((s) => (s.kind === 'text' ? s.text : ''))).toEqual(['!two']);
  });

  it('calling fromDoc twice on the same doc reuses every block', () => {
    const { mapper, state } = twoBlockState();
    const first = mapper.fromDoc(state.doc);
    const second = mapper.fromDoc(state.doc);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  it('a block edited and then edited back still gets fresh output, not a stale hit', () => {
    const { mapper, state } = twoBlockState();
    const before = mapper.fromDoc(state.doc);

    const secondBlockStart = state.doc.child(0).nodeSize;
    const edited = state.apply(state.tr.insertText('!', secondBlockStart + 2));
    mapper.fromDoc(edited.doc);
    const reverted = edited.apply(edited.tr.delete(secondBlockStart + 2, secondBlockStart + 3));
    const after = mapper.fromDoc(reverted.doc);

    // A different Node object than the original (undo-less delete, not the same
    // instance), but it must still serialize correctly rather than reusing the
    // edited-state's cache entry keyed on a node that no longer exists.
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].spans.map((s) => (s.kind === 'text' ? s.text : ''))).toEqual(['two']);
  });
});
