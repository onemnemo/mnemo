// @vitest-environment node

/**
 * The callout glyph verb. Driven by a real editable state and a dispatch stub
 * rather than a mounted view: what is under test is which node the write lands
 * on, what it preserves, and where the undo boundary falls, none of which needs
 * a DOM.
 */

import { describe, expect, it } from 'vitest';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { undo } from '../history';
import type { BlockRegistry } from '../registry/build';
import { isCalloutNode, setCalloutEmoji } from './callout-icon';

type Blocks = Parameters<typeof buildNoteEditState>[0];

interface Harness {
  view: EditorView;
  registry: BlockRegistry;
  dispatched: Transaction[];
  state(): EditorState;
}

function mount(blocks: Blocks): Harness {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  let state = built.state;
  const dispatched: Transaction[] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      dispatched.push(tr);
      state = state.apply(tr);
    },
    focus() {},
  } as unknown as EditorView;
  return { view, registry: built.registry, dispatched, state: () => state };
}

/** Position and sid of the top-level block at `index`. */
function at(state: EditorState, index: number): { pos: number; sid: string } {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return { pos, sid: String(state.doc.child(index).attrs.sid ?? '') };
}

/** The first callout in the document, wherever it ended up. */
function callout(state: EditorState): { pos: number; attrs: Record<string, unknown> } {
  let found: { pos: number; attrs: Record<string, unknown> } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (isCalloutNode(node)) {
      found = { pos, attrs: node.attrs };
      return false;
    }
    return true;
  });
  if (!found) throw new Error('no callout in the doc');
  return found;
}

/** Just past the document's last text, a position typing can land on. */
function endOfText(state: EditorState): number {
  let at = 0;
  state.doc.descendants((node, pos) => {
    if (node.isText) at = pos + node.nodeSize;
    return true;
  });
  return at;
}

function calloutNote(): Harness {
  return mount([
    block('Callout', [span('remember')], { kind: 'callout', emoji: '💡', tone: 'warn' }),
    block('Text', [span('after')]),
  ]);
}

describe('setCalloutEmoji', () => {
  it('writes the glyph and leaves every other attr alone', () => {
    const h = calloutNote();
    const before = callout(h.state()).attrs;
    expect(setCalloutEmoji(h.view, h.registry, at(h.state(), 0), '🚀')).toBe(true);

    const after = callout(h.state()).attrs;
    expect(after.emoji).toBe('🚀');
    expect(after.tone).toBe('warn');
    expect(after.id).toBe(before.id);
    expect(after.sid).toBe(before.sid);
  });

  it('clears the glyph to nothing, which renders a callout without one', () => {
    const h = calloutNote();
    expect(setCalloutEmoji(h.view, h.registry, at(h.state(), 0), '')).toBe(true);
    expect(callout(h.state()).attrs.emoji).toBe('');
  });

  it('re-locates a stale position instead of writing to whatever sits there now', () => {
    const h = calloutNote();
    const target = at(h.state(), 0);
    // A block arrives above the callout, so the snapshot's position now points at
    // a paragraph. A write there would rewrite the wrong block, handing it the
    // callout's identity along with a glyph its type does not even carry.
    const paragraph = h.state().schema.nodes.paragraph?.createAndFill();
    if (!paragraph) throw new Error('the schema has no paragraph');
    h.view.dispatch(h.state().tr.insert(0, paragraph));
    const intruder = at(h.state(), 0);

    expect(setCalloutEmoji(h.view, h.registry, target, '🚀')).toBe(true);
    expect(callout(h.state()).attrs.emoji).toBe('🚀');
    expect(callout(h.state()).attrs.sid).toBe(target.sid);
    // The block that took the stale position is untouched, sid included.
    expect(h.state().doc.child(0).type.name).toBe('paragraph');
    expect(String(h.state().doc.child(0).attrs.sid)).toBe(intruder.sid);
  });

  it('does nothing to a block that is not a callout', () => {
    const h = calloutNote();
    expect(setCalloutEmoji(h.view, h.registry, at(h.state(), 1), '🚀')).toBe(false);
    expect(h.dispatched).toHaveLength(0);
  });

  it('does nothing when the block is gone', () => {
    const h = calloutNote();
    const target = at(h.state(), 0);
    h.view.dispatch(h.state().tr.delete(target.pos, target.pos + h.state().doc.child(0).nodeSize));
    const before = h.dispatched.length;
    expect(setCalloutEmoji(h.view, h.registry, target, '🚀')).toBe(false);
    expect(h.dispatched).toHaveLength(before);
  });

  it('is its own undo step, so one undo takes back the glyph and nothing else', () => {
    const h = calloutNote();
    h.view.dispatch(h.state().tr.insertText('!', endOfText(h.state())));
    const withText = h.state().doc.textContent;
    setCalloutEmoji(h.view, h.registry, at(h.state(), 0), '🚀');

    let restored = h.state();
    undo(h.state(), (tr) => {
      restored = h.state().apply(tr);
    });
    expect(callout(restored).attrs.emoji).toBe('💡');
    // The typing before it survives: the two are not one group.
    expect(restored.doc.textContent).toBe(withText);
  });
});
