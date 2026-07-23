// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorView } from 'prosemirror-view';
import type { EditorView as EditorViewType } from 'prosemirror-view';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
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
