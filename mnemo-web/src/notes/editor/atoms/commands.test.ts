/**
 * `insertEquation`, the one creation behaviour the later menu/keymap surfaces
 * share. Tested against real states: it inserts an inline atom where the content
 * model allows one, and refuses where it does not.
 */

import { describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { defaultTextStyle, type Block, type BlockPayload, type BlockType } from '../../model/types';
import { insertEquation } from './commands';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

function blockOf(type: BlockType, spans: Block['spans'], payload: BlockPayload): Block {
  return { id: 'id-1', sid: 's0001', type, spans, payload, meta: {}, order: 0, children: null };
}

function stateOf(block: Block): EditorState {
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema });
}

function paragraphState(text: string): EditorState {
  return stateOf(
    blockOf('Text', [{ kind: 'text', text, style: { ...defaultTextStyle } }], { kind: 'empty' }),
  );
}

function codeState(source: string): EditorState {
  return stateOf(blockOf('Code', [], { kind: 'code', language: 'text', source }));
}

/** Caret at `pos`. */
function withCaret(state: EditorState, pos: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/** The whole of the first block's line selected, which is what a toolbar press acts on. */
function selectingAll(state: EditorState): EditorState {
  let line = -1;
  state.doc.descendants((node, pos) => {
    if (line < 0 && node.type.name === 'line') line = pos;
    return line < 0;
  });
  if (line < 0) throw new Error('no line in fixture');
  const node = state.doc.nodeAt(line);
  if (!node) throw new Error('no line in fixture');
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, line + 1, line + 1 + node.content.size)),
  );
}

function firstEquation(doc: PMNode): PMNode | null {
  let found: PMNode | null = null;
  doc.descendants((node) => {
    if (node.type.name === 'equationSpan') {
      found = node;
      return false;
    }
    return true;
  });
  return found;
}

describe('insertEquation', () => {
  it('inserts an inline equation at the caret', () => {
    const state = withCaret(paragraphState('ab'), 2);
    const dispatch = vi.fn<(tr: Transaction) => void>();
    expect(insertEquation()(state, dispatch)).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();
    const atom = firstEquation(dispatch.mock.calls[0][0].doc);
    expect(atom?.type.name).toBe('equationSpan');
    expect(atom?.attrs.latex).toBe('');
  });

  it('inserts with the given LaTeX', () => {
    const state = withCaret(paragraphState('ab'), 2);
    const dispatch = vi.fn<(tr: Transaction) => void>();
    insertEquation('a^2')(state, dispatch);
    expect(firstEquation(dispatch.mock.calls[0][0].doc)?.attrs.latex).toBe('a^2');
  });

  it('replaces a non-empty selection', () => {
    const base = paragraphState('ab');
    // Select the text `ab` itself, inline content lives inside a `line` node,
    // so its range is found rather than assumed.
    let from = -1;
    let to = -1;
    base.doc.descendants((node, pos) => {
      if (node.isText) {
        from = pos;
        to = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, from, to)));
    const dispatch = vi.fn<(tr: Transaction) => void>();
    insertEquation('q')(state, dispatch);
    const doc = dispatch.mock.calls[0][0].doc;
    expect(firstEquation(doc)?.attrs.latex).toBe('q');
    // The selected `ab` is gone, replaced by the atom.
    expect(doc.textContent).toBe('');
  });

  /**
   * The regression the seeded source exists for: the toolbar only appears over
   * a selection, so an insert that ignored it deleted whatever the user had
   * highlighted and put an atom with no source in its place, which typesets to
   * nothing. The text went in and nothing came out.
   */
  it('takes its source from the selected text', () => {
    const state = selectingAll(paragraphState('E=mc^2'));
    const dispatch = vi.fn<(tr: Transaction) => void>();
    insertEquation()(state, dispatch);
    expect(firstEquation(dispatch.mock.calls[0][0].doc)?.attrs.latex).toBe('E=mc^2');
  });

  it('strips one layer of dollar delimiters off the selected text', () => {
    const state = selectingAll(paragraphState('$a^2$'));
    const dispatch = vi.fn<(tr: Transaction) => void>();
    insertEquation()(state, dispatch);
    expect(firstEquation(dispatch.mock.calls[0][0].doc)?.attrs.latex).toBe('a^2');
  });

  it('folds an atom inside the selection in as its source rather than dropping it', () => {
    const block = blockOf(
      'Text',
      [
        { kind: 'text', text: 'x=', style: { ...defaultTextStyle } },
        { kind: 'fraction', numerator: 3, denominator: 4, style: { ...defaultTextStyle } },
      ],
      { kind: 'empty' },
    );
    const state = selectingAll(stateOf(block));
    const dispatch = vi.fn<(tr: Transaction) => void>();
    insertEquation()(state, dispatch);
    expect(firstEquation(dispatch.mock.calls[0][0].doc)?.attrs.latex).toBe('x=3/4');
  });

  it('reports availability without a dispatch', () => {
    const state = withCaret(paragraphState('ab'), 2);
    expect(insertEquation()(state)).toBe(true);
  });

  it('refuses inside a code block, whose content is plain text', () => {
    const state = withCaret(codeState('hi'), 1);
    const dispatch = vi.fn<(tr: Transaction) => void>();
    expect(insertEquation()(state, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  /**
   * The case above resolves to the code *block*, which never admitted an atom.
   * These put the selection in the source line itself, which does admit one so
   * that wire data carrying an equation survives a round trip. Creating one
   * there is still refused, and a range is covered separately because that is
   * what a toolbar press acts on and it replaces the code it spans.
   */
  function inCodeLine(state: EditorState, from: number, to = from): EditorState {
    let pos = -1;
    state.doc.descendants((node, at) => {
      if (pos < 0 && node.type.name === 'codeLine') pos = at + 1;
      return pos < 0;
    });
    if (pos < 0) throw new Error('no code line in fixture');
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pos + from, pos + to)),
    );
  }

  it('refuses at a caret inside the source line, which the schema would allow', () => {
    const state = inCodeLine(codeState('const x = 1;'), 2);
    expect(state.selection.$from.parent.type.name).toBe('codeLine');
    const dispatch = vi.fn<(tr: Transaction) => void>();
    expect(insertEquation()(state, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses over a selected run of source rather than replacing it', () => {
    const state = inCodeLine(codeState('const x = 1;'), 0, 5);
    const dispatch = vi.fn<(tr: Transaction) => void>();
    expect(insertEquation()(state, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(state.doc.textContent).toContain('const');
  });

  it('still inserts in ordinary prose', () => {
    const state = withCaret(paragraphState('ab'), 2);
    const dispatch = vi.fn<(tr: Transaction) => void>();
    expect(insertEquation()(state, dispatch)).toBe(true);
    expect(firstEquation(dispatch.mock.calls[0]![0].doc)).not.toBeNull();
  });
});
