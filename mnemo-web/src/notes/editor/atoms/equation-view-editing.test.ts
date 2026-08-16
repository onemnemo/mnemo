// @vitest-environment jsdom

/**
 * The equation view's editing wiring: activation opens the source editor, and a
 * resolution turns into the right transaction. Driven by a real EditorState and
 * a dispatch spy rather than a mounted view, but the state
 * arithmetic (resolve the live position, change only the latex, place the caret)
 * is all exercisable here.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import { defaultTextStyle, type Block } from '../../model/types';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { equationView } from './equation-view';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

// Each harness attaches its atom and editor to the body; without this, one
// test's leftover editor is what the next test's body-scoped query would find.
afterEach(() => {
  document.body.replaceChildren();
});

/** A one-block note: the text `a` followed by an inline equation. */
function docWith(latex: string): PMNode {
  const block: Block = {
    id: 'id-1',
    sid: 's0001',
    type: 'Text',
    spans: [
      { kind: 'text', text: 'a', style: { ...defaultTextStyle } },
      { kind: 'equation', latex, style: { ...defaultTextStyle } },
    ],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

function findEquation(doc: PMNode): { pos: number; node: PMNode } {
  let found: { pos: number; node: PMNode } | undefined;
  doc.descendants((node, pos) => {
    if (node.type.name === 'equationSpan') {
      found = { pos, node };
      return false;
    }
    return true;
  });
  if (!found) throw new Error('no equation atom in the doc');
  return found;
}

interface Harness {
  view: EditorView;
  dispatched: Transaction[];
  atomPos: number;
  realized: RealizedBlockView;
  focus: ReturnType<typeof vi.fn>;
  /** The equation node, read from the live state at `atomPos`. */
  liveLatex(): string;
}

function harnessOf(latex: string): Harness {
  let state = EditorState.create({ doc: docWith(latex), schema });
  const { pos, node } = findEquation(state.doc);
  const dispatched: Transaction[] = [];
  const focus = vi.fn();

  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      dispatched.push(tr);
      state = state.apply(tr);
    },
    focus,
  } as unknown as EditorView;

  const args = {
    node,
    view,
    getPos: () => pos,
    attrs: node.attrs,
    host: { mode: 'realized', requestMode() {}, destroy() {} },
    services: {},
  } as unknown as RealizedBlockViewArgs<Record<string, unknown>>;

  const realized = equationView(args);
  document.body.append(realized.dom);

  return {
    view,
    dispatched,
    atomPos: pos,
    realized,
    focus,
    liveLatex() {
      return String(state.doc.nodeAt(pos)?.attrs.latex ?? '');
    },
  };
}

function openEditor(realized: RealizedBlockView): HTMLInputElement {
  realized.dom.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const input = realized.dom.parentElement?.querySelector<HTMLInputElement>(
    '.notes-equation-editor-source',
  );
  if (!input) throw new Error('editor did not open');
  return input;
}

function commit(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

describe('opening the editor', () => {
  it('opens on click, preloaded with the current source', () => {
    const h = harnessOf('x^2');
    const input = openEditor(h.realized);
    expect(input.value).toBe('x^2');
  });

  it('does not open a second editor while one is open', () => {
    const h = harnessOf('x');
    openEditor(h.realized);
    h.realized.dom.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const inputs = h.realized.dom.parentElement?.querySelectorAll('.notes-equation-editor-source');
    expect(inputs?.length).toBe(1);
  });
});

describe('committing an edit', () => {
  it('dispatches a markup change that updates only the latex', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    commit(input, 'y^2');
    expect(h.dispatched).toHaveLength(1);
    expect(h.liveLatex()).toBe('y^2');
    // The change is a setNodeMarkup, not a replace: the atom keeps its identity.
    expect(h.dispatched[0].docChanged).toBe(true);
  });

  it('returns focus to the editor after committing', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    commit(input, 'y');
    expect(h.focus).toHaveBeenCalled();
  });

  it('commits invalid LaTeX verbatim', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    commit(input, '\\frac{');
    expect(h.liveLatex()).toBe('\\frac{');
  });

  it('does nothing, and does not throw, when the atom is gone by commit time', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    // The atom is deleted underneath the open editor (a remote edit, an undo).
    h.view.dispatch(h.view.state.tr.delete(h.atomPos, h.atomPos + 1));
    const before = h.dispatched.length;
    input.value = 'y';
    expect(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      ),
    ).not.toThrow();
    // The delete was the only new dispatch; the commit resolved to nothing.
    expect(h.dispatched.length).toBe(before);
  });
});

describe('cancelling', () => {
  it('dispatches nothing and refocuses on Escape', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    input.value = 'changed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(h.dispatched).toHaveLength(0);
    expect(h.liveLatex()).toBe('x');
    expect(h.focus).toHaveBeenCalled();
  });
});

describe('arrow escape', () => {
  it('commits and lands the caret after the atom on ArrowRight at the end', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    input.value = 'z';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(h.liveLatex()).toBe('z');
    // The atom is one position wide, so "after" is its pos + 1.
    expect(h.view.state.selection.from).toBe(h.atomPos + 1);
  });

  it('lands the caret before the atom on ArrowLeft at the start', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    input.setSelectionRange(0, 0);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(h.view.state.selection.from).toBe(h.atomPos);
  });
});

describe('teardown', () => {
  it('destroy closes an open editor and drops the click handler', () => {
    const h = harnessOf('x');
    openEditor(h.realized);
    h.realized.destroy?.();
    expect(h.realized.dom.parentElement?.querySelector('.notes-equation-editor-source')).toBeFalsy();
    // A click after destroy opens nothing.
    h.realized.dom.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.realized.dom.parentElement?.querySelector('.notes-equation-editor-source')).toBeFalsy();
  });
});
