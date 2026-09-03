/**
 * The order field a save writes back is document position, at every level.
 *
 * The editor never reads it, but every reader on the other side of the wire
 * sorts by it: the PDF and markdown exports, the plain text projection, and the
 * note tools, which commit the sorted list back. A block created by an edit
 * starts with the schema default, so a save that merely passed the loaded value
 * through would export a note with its new blocks sorted to the front.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { createEditorSchema } from '../schema';
import { createDocumentMapper } from './document';
import { splitBlock } from '../commands/structure';
import { blockIdentityPlugin } from '../pipeline/block-identity';
import { defaultTextStyle, type Block, type InlineSpan } from '../../model/types';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

function span(text: string): InlineSpan {
  return { kind: 'text', text, style: { ...defaultTextStyle } };
}

function para(n: number): Block {
  return {
    id: `id-${String(n)}`,
    sid: `s000${String(n)}`,
    type: 'Text',
    spans: [span(`paragraph ${String(n)}`)],
    payload: { kind: 'empty' },
    meta: {},
    order: n,
    children: null,
  };
}

function stateOf(blocks: readonly Block[]): EditorState {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({
    schema,
    doc: result.doc,
    plugins: [blockIdentityPlugin(registry)],
  });
}

/** Position just inside the end of the top-level block at `index`. */
function endOfBlock(state: EditorState, index: number): number {
  let at = -1;
  state.doc.forEach((child, offset, i) => {
    if (i === index) at = offset + child.nodeSize - 2;
  });
  return at;
}

describe('the order field a save writes back', () => {
  it('is document order after a split in the middle of a note', () => {
    // Four paragraphs, stored 0..3 the way the desktop wrote them.
    let state = stateOf([para(0), para(1), para(2), para(3)]);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, endOfBlock(state, 1))));

    // Enter at the end of the second paragraph: a new block appears third.
    splitBlock(state, (tr) => {
      state = state.apply(tr);
    });

    const blocks = mapper.fromDoc(state.doc);
    expect(blocks).toHaveLength(5);
    // Every block has an identity, so this is a real save-shaped document.
    expect(blocks.every((b) => b.sid.length > 0)).toBe(true);
    // What C# will sort by. Document order is 0,1,new,2,3.
    expect(blocks.map((b) => b.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('is document order after a block is dragged above its neighbour', () => {
    let state = stateOf([para(0), para(1), para(2)]);
    // Move the last block to the front, which is what the gutter drag does.
    let pos = 0;
    let size = 0;
    state.doc.forEach((child, offset, i) => {
      if (i === 2) {
        pos = offset;
        size = child.nodeSize;
      }
    });
    const node = state.doc.child(2);
    state = state.apply(state.tr.delete(pos, pos + size).insert(0, node));

    const blocks = mapper.fromDoc(state.doc);
    expect(blocks.map((b) => b.order)).toEqual([0, 1, 2]);
  });
});
