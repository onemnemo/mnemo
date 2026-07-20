/**
 * The structural guarantees an inline atom must hold, independent of any view:
 * it is one indivisible caret unit, a selection can never split it, formatting a
 * range that covers it reaches it, and it selects as a single node.
 *
 * These are properties of the schema — `atom: true`, `marks: "_"` — not of the
 * renderer, so they are proven against the document and its selections directly.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { defaultTextStyle, type Block } from '../../model/types';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

/** `ab` · equation(`x`) · `cd` in one text block. */
function stateWithAtom(): EditorState {
  const block: Block = {
    id: 'id-1',
    sid: 's0001',
    type: 'Text',
    spans: [
      { kind: 'text', text: 'ab', style: { ...defaultTextStyle } },
      { kind: 'equation', latex: 'x', style: { ...defaultTextStyle } },
      { kind: 'text', text: 'cd', style: { ...defaultTextStyle } },
    ],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema });
}

function atomPosOf(doc: PMNode): number {
  let pos = -1;
  doc.descendants((node, at) => {
    if (node.type.name === 'equationSpan') {
      pos = at;
      return false;
    }
    return true;
  });
  if (pos < 0) throw new Error('no equation atom');
  return pos;
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

describe('an inline atom is one caret unit', () => {
  it('occupies exactly one position and holds no interior', () => {
    const state = stateWithAtom();
    const atom = state.doc.nodeAt(atomPosOf(state.doc));
    expect(atom?.nodeSize).toBe(1);
    // Atomic and a leaf: there is no position inside for a caret to land on.
    expect(atom?.isAtom).toBe(true);
    expect(atom?.isLeaf).toBe(true);
  });

  it('selects as a single node, not a text range', () => {
    const state = stateWithAtom();
    const selection = NodeSelection.create(state.doc, atomPosOf(state.doc));
    expect(selection.node.type.name).toBe('equationSpan');
    expect(selection.node.attrs.latex).toBe('x');
    // The whole node, one position wide.
    expect(selection.to - selection.from).toBe(1);
  });
});

describe('a selection can never split the atom', () => {
  it('a delete stopping at its start leaves it whole', () => {
    const state = stateWithAtom();
    const pos = atomPosOf(state.doc);
    // Delete from inside `ab` up to the atom's start; the atom is not in range.
    const next = state.apply(state.tr.delete(2, pos)).doc;
    const atom = firstEquation(next);
    expect(atom).not.toBeNull();
    expect(atom?.attrs.latex).toBe('x');
  });

  it('a delete crossing it removes it whole — never a fragment', () => {
    const state = stateWithAtom();
    const pos = atomPosOf(state.doc);
    // From inside `ab` to inside `cd`, straddling the atom.
    const next = state.apply(state.tr.delete(2, pos + 2)).doc;
    expect(firstEquation(next)).toBeNull();
    // And no partial LaTeX leaked into the text.
    expect(next.textContent).not.toContain('x');
  });

  it('slicing across it carries the whole atom, LaTeX intact', () => {
    const state = stateWithAtom();
    const pos = atomPosOf(state.doc);
    const slice = state.doc.slice(pos, pos + 1);
    // A single-position slice of the atom is exactly the atom, unopened.
    expect(slice.content.firstChild?.type.name).toBe('equationSpan');
    expect(slice.content.firstChild?.attrs.latex).toBe('x');
  });
});

describe('formatting reaches the atom', () => {
  it('a bold applied across a mixed range marks the atom node itself', () => {
    const state = stateWithAtom();
    const strong = schema.marks.strong;
    // Cover the whole line: `ab`, the atom, and `cd`.
    const next = state.apply(state.tr.addMark(1, state.doc.content.size - 1, strong.create())).doc;
    const atom = firstEquation(next);
    expect(atom).not.toBeNull();
    // `marks: "_"` governs the atom's content; the node still carries its own marks.
    expect(strong.isInSet(atom!.marks)).toBeDefined();
  });
});
