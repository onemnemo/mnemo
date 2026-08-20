// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorView } from 'prosemirror-view';
import type { EditorView as EditorViewType } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, scaleFixture, span } from '../mapper/fixtures';
import { ensureRealized, topLevelBlockAt } from './ensure-realized';

type Blocks = Parameters<typeof buildNoteEditState>[0];

function stateOf(blocks: Blocks) {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  return built.state;
}

/** A three-block document, enough to resolve first / middle / last. */
function three() {
  return stateOf([
    block('Text', [span('alpha')]),
    block('Heading1', [span('beta')]),
    block('Text', [span('gamma')]),
  ]);
}

describe('topLevelBlockAt', () => {
  it('resolves a position inside a block to that block', () => {
    const state = three();
    const view = { state } as unknown as EditorViewType;

    // A position within the second block resolves to index 1.
    const secondStart = state.doc.child(0).nodeSize;
    const inSecond = topLevelBlockAt(view, secondStart + 2);
    expect(inSecond?.index).toBe(1);
    expect(inSecond?.pos).toBe(secondStart);
    expect(inSecond?.node.textContent).toBe('beta');
  });

  it('clamps a position past the end to the last block', () => {
    const state = three();
    const view = { state } as unknown as EditorViewType;
    const located = topLevelBlockAt(view, state.doc.content.size + 50);
    expect(located?.index).toBe(2);
    expect(located?.node.textContent).toBe('gamma');
  });

  it('maps the document start to the first block', () => {
    const state = three();
    const view = { state } as unknown as EditorViewType;
    expect(topLevelBlockAt(view, 0)?.index).toBe(0);
  });

  it('returns null for an empty document', () => {
    // A single empty paragraph is the minimum; force a truly empty doc via a slice.
    const state = three();
    const emptyDoc = state.doc.type.create(null, []);
    const view = { state: { doc: emptyDoc } } as unknown as EditorViewType;
    expect(topLevelBlockAt(view, 0)).toBeNull();
  });
});

/**
 * A document with a container nested two levels deep: a two-column row whose
 * left cell holds another two-column row. Exercises the guard branch from a
 * position that resolves inside a container, not only at the top level.
 */
function nestedContainerBlocks(): Blocks {
  return [
    block('Heading1', [span('intro')]),
    block('Text', [span('before the split')]),
    block(
      'TwoColumn',
      [span('')],
      { kind: 'twoColumn', splitRatio: 0.5 },
      {
        children: [
          block(
            'ColumnGroup',
            [span('')],
            { kind: 'empty' },
            {
              children: [
                block(
                  'TwoColumn',
                  [span('')],
                  { kind: 'twoColumn', splitRatio: 0.5 },
                  {
                    children: [
                      block('ColumnGroup', [span('')], { kind: 'empty' }, {
                        children: [block('Text', [span('deep left')])],
                      }),
                      block('ColumnGroup', [span('')], { kind: 'empty' }, {
                        children: [block('Text', [span('deep right')])],
                      }),
                    ],
                  },
                ),
              ],
            },
          ),
          block('ColumnGroup', [span('')], { kind: 'empty' }, {
            children: [block('Text', [span('shallow right, with a longer line of text in it')])],
          }),
        ],
      },
    ),
    block('Text', [span('after the split')]),
    block('BulletList', [span('trailing bullet')]),
  ];
}

/**
 * `topLevelBlockAt` against the loop it replaced.
 *
 * Before the fix, `pos` came from summing every earlier sibling's `nodeSize`
 * from the document start on every call. The guarded version reuses
 * `$pos.before(1)`, work `doc.resolve` already did, except past the last
 * child, where depth 0 has nothing for `before(1)` to name and it answers
 * with the clamped position rather than the last block's start. This sweeps
 * every position on two documents so that boundary stays proven rather than
 * merely asserted, with the old loop kept independent of the function under
 * test so the sweep checks the fast path against the slow one, not against
 * itself.
 */
describe('topLevelBlockAt against the pre-fix loop', () => {
  function oldTopLevelBlockAt(doc: PMNode, pos: number): { pos: number; index: number } | null {
    if (doc.childCount === 0) return null;

    const clamped = Math.max(0, Math.min(pos, doc.content.size));
    const $pos = doc.resolve(clamped);
    const index = Math.min($pos.index(0), doc.childCount - 1);

    let before = 0;
    for (let i = 0; i < index; i++) before += doc.child(i).nodeSize;
    return { pos: before, index };
  }

  function sweep(doc: PMNode): { swept: number; mismatches: unknown[] } {
    const view = { state: { doc } } as unknown as EditorViewType;
    const max = doc.content.size + 3;
    const mismatches: Array<{ pos: number; expected: unknown; actual: unknown }> = [];
    for (let pos = 0; pos <= max; pos++) {
      const expected = oldTopLevelBlockAt(doc, pos);
      const located = topLevelBlockAt(view, pos);
      const actual = located && { pos: located.pos, index: located.index };
      const isMismatch =
        actual === null || expected === null
          ? actual !== expected
          : actual.pos !== expected.pos || actual.index !== expected.index;
      if (isMismatch) mismatches.push({ pos, expected, actual });
    }
    return { swept: max + 1, mismatches };
  }

  it('matches on every position from 0 to content.size + 3, a document with a nested container', () => {
    const state = stateOf(nestedContainerBlocks());
    const { swept, mismatches } = sweep(state.doc);
    expect(mismatches, `${String(mismatches.length)} of ${String(swept)} swept positions mismatched`).toEqual([]);
  });

  it('matches on every position from 0 to content.size + 3, 200+ blocks of varied size', () => {
    const state = stateOf(scaleFixture(220).blocks);
    expect(state.doc.childCount).toBeGreaterThanOrEqual(200);
    const { swept, mismatches } = sweep(state.doc);
    expect(mismatches, `${String(mismatches.length)} of ${String(swept)} swept positions mismatched`).toEqual([]);
  });
});

describe('ensureRealized', () => {
  it('returns the DOM element and rect for the block containing a position', () => {
    const state = three();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      const secondStart = state.doc.child(0).nodeSize;
      const realized = ensureRealized(view, secondStart + 1);
      expect(realized).not.toBeNull();
      expect(realized?.index).toBe(1);
      // The element is the block's own DOM node, a direct child of the editor root.
      expect(realized?.dom.parentElement).toBe(view.dom);
      expect(realized?.dom).toBe(view.dom.children[1]);
      // A rect is produced (geometry is zero in jsdom, but the call must not throw).
      expect(typeof realized?.rect.top).toBe('number');
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
