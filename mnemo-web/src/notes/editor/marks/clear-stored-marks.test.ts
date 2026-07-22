/**
 * `clearStoredMarks`, the sticky-typing escape. The one behaviour an
 * inherited-format editor cannot express: at a caret inside formatted text, arm
 * the next character to carry *no* marks. Tested for the empty-array vs null
 * distinction that makes "none" mean none, not "inherit".
 */

import { describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { defaultTextStyle, type Block, type TextStyle } from '../../model/types';
import { clearStoredMarks } from './commands';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

function textBlock(text: string, style?: Partial<TextStyle>): Block {
  return {
    id: 'id-1',
    sid: 's0001',
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle, ...style } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
}

function stateOf(block: Block): EditorState {
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema });
}

/** Caret inside the first text run. */
function caretInRun(state: EditorState): EditorState {
  let pos = -1;
  state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText) pos = at + 1;
    return pos < 0;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function dispatched(state: EditorState): Transaction | null {
  const dispatch = vi.fn<(tr: Transaction) => void>();
  const ok = clearStoredMarks(state, dispatch);
  return ok ? dispatch.mock.calls[0][0] : null;
}

describe('clearStoredMarks', () => {
  it('arms an explicit empty mark set inside formatted text', () => {
    const tr = dispatched(caretInRun(stateOf(textBlock('abcd', { bold: true }))));
    expect(tr).not.toBeNull();
    // Empty array, "none", not null, which would inherit the surrounding bold.
    expect(tr!.storedMarks).toEqual([]);
    expect(schema.marks.strong.isInSet(tr!.storedMarks!)).toBeFalsy();
  });

  it('overrides marks the caret would otherwise inherit', () => {
    // Position matters: null here would let the next character pick bold back up.
    const tr = dispatched(caretInRun(stateOf(textBlock('abcd', { bold: true, italic: true }))));
    expect(tr!.storedMarks).not.toBeNull();
    expect(tr!.storedMarks).toHaveLength(0);
  });

  it('refuses when there is nothing to escape', () => {
    // Plain caret with no inherited marks: the key should fall through.
    expect(clearStoredMarks(caretInRun(stateOf(textBlock('abcd'))), vi.fn())).toBe(false);
  });

  it('refuses on a range selection, it is a caret-only affordance', () => {
    const state = stateOf(textBlock('abcd', { bold: true }));
    let from = -1;
    let to = -1;
    state.doc.descendants((node, pos) => {
      if (node.isText) {
        from = pos;
        to = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    const ranged = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    expect(clearStoredMarks(ranged, vi.fn())).toBe(false);
  });
});
