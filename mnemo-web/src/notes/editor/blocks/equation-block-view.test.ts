// @vitest-environment jsdom

/**
 * The block equation's renderer and its editing wiring.
 *
 * Driven by a real `EditorState` and a dispatch spy rather than a mounted view,
 * the same harness shape the inline atom's editing test uses: what is under test
 * is what the view draws and which transaction it produces, and neither needs a
 * layout engine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import type { Block } from '../../model/types';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { useI18nStore } from '../../../i18n/store';
import { fallbackClass } from '../atoms/katex';
import { equationBlockView } from './equation-block-view';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

const PLACEHOLDER = 'Click to add an equation';

beforeEach(() => {
  // The real path reads the live bundle, so seed one: a test that accepted the
  // key back would pass just as well against a view that never translated.
  useI18nStore.setState({
    bundle: { NotesEditor: { EquationPlaceholder: PLACEHOLDER, Equation: 'Equation' } },
  });
});

afterEach(() => {
  document.body.replaceChildren();
  useI18nStore.setState({ bundle: {} });
});

function docWith(latex: string): PMNode {
  const block: Block = {
    id: 'id-1',
    sid: 's0001',
    type: 'Equation',
    spans: [],
    payload: { kind: 'equation', latex },
    meta: {},
    order: 0,
    children: null,
  };
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

function findEquationBlock(doc: PMNode): { pos: number; node: PMNode } {
  let found: { pos: number; node: PMNode } | undefined;
  doc.descendants((node, pos) => {
    if (node.type.name === 'equationBlock') {
      found = { pos, node };
      return false;
    }
    return true;
  });
  if (!found) throw new Error('no equation block in the doc');
  return found;
}

interface Harness {
  dispatched: Transaction[];
  realized: RealizedBlockView;
  focus: ReturnType<typeof vi.fn>;
  liveLatex(): string;
  /** The node as it is now, for driving `update` the way ProseMirror would. */
  liveNode(): PMNode;
}

function harnessOf(latex: string, options: { editable?: boolean } = {}): Harness {
  let state = EditorState.create({ doc: docWith(latex), schema });
  const { pos, node } = findEquationBlock(state.doc);
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
    editable: options.editable ?? true,
  } as unknown as EditorView;

  const args = {
    node,
    view,
    getPos: () => pos,
    attrs: node.attrs,
    host: { mode: 'realized', requestMode() {}, destroy() {} },
    services: {},
  } as unknown as RealizedBlockViewArgs<Record<string, unknown>>;

  const realized = equationBlockView(args);
  document.body.append(realized.dom);

  return {
    dispatched,
    realized,
    focus,
    liveLatex() {
      return String(state.doc.nodeAt(pos)?.attrs.latex ?? '');
    },
    liveNode() {
      const live = state.doc.nodeAt(pos);
      if (!live) throw new Error('block vanished');
      return live;
    },
  };
}

function click(realized: RealizedBlockView): void {
  realized.dom.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function sourceInput(realized: RealizedBlockView): HTMLInputElement | null {
  return (
    realized.dom.parentElement?.querySelector<HTMLInputElement>('.notes-equation-editor-source') ??
    null
  );
}

function openEditor(realized: RealizedBlockView): HTMLInputElement {
  click(realized);
  const input = sourceInput(realized);
  if (!input) throw new Error('editor did not open');
  return input;
}

function press(target: EventTarget, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('what it draws', () => {
  it('typesets the source', () => {
    const h = harnessOf('x^2');
    expect(h.realized.dom.querySelector('.katex')).not.toBeNull();
    expect(h.realized.dom.getAttribute('role')).toBe('math');
  });

  it('reads the source out rather than the rendering', () => {
    const h = harnessOf('\\frac{a}{b}');
    expect(h.realized.dom.getAttribute('aria-label')).toBe('\\frac{a}{b}');
  });

  it('typesets in display style, not the inline style the atoms use', () => {
    const h = harnessOf('x^2');
    expect(h.realized.dom.querySelector('.katex-display')).not.toBeNull();
  });

  it('offers to be filled in when it has no source yet', () => {
    const h = harnessOf('');
    expect(h.realized.dom.textContent).toBe(PLACEHOLDER);
    expect(h.realized.dom.classList.contains('notes-equation-block-empty')).toBe(true);
  });

  it('is not announced as maths while it is still empty', () => {
    const h = harnessOf('');
    expect(h.realized.dom.getAttribute('role')).toBeNull();
  });

  it('keeps invalid source rather than refusing to draw it', () => {
    const h = harnessOf('\\frac{');
    expect(h.realized.dom.getAttribute('aria-label')).toBe('\\frac{');
    expect(h.realized.dom.textContent).not.toBe(PLACEHOLDER);
  });
});

describe('redrawing', () => {
  it('typesets again when the source changed', () => {
    const h = harnessOf('x');
    const updated = schema.nodes.equationBlock.create(
      { ...h.liveNode().attrs, latex: 'y' },
      h.liveNode().content,
    );
    h.realized.update?.(updated);
    expect(h.realized.dom.getAttribute('aria-label')).toBe('y');
  });

  it('leaves the DOM alone when the source did not change', () => {
    const h = harnessOf('x^2');
    const before = h.realized.dom.querySelector('.katex');
    h.realized.update?.(h.liveNode());
    expect(h.realized.dom.querySelector('.katex')).toBe(before);
  });

  /**
   * The fallback class marks a render that gave up and drew the source as
   * plain text. Clearing the source clears the failure with it, or the
   * placeholder inherits the styling of an error that no longer exists.
   */
  it('clears a previous render failure when the source is cleared', () => {
    const h = harnessOf('x');
    h.realized.dom.classList.add(fallbackClass);
    const emptied = schema.nodes.equationBlock.create(
      { ...h.liveNode().attrs, latex: '' },
      h.liveNode().content,
    );
    h.realized.update?.(emptied);
    expect(h.realized.dom.classList.contains(fallbackClass)).toBe(false);
  });

  it('goes back to the placeholder when the source is cleared', () => {
    const h = harnessOf('x');
    const emptied = schema.nodes.equationBlock.create(
      { ...h.liveNode().attrs, latex: '' },
      h.liveNode().content,
    );
    h.realized.update?.(emptied);
    expect(h.realized.dom.textContent).toBe(PLACEHOLDER);
    expect(h.realized.dom.querySelector('.katex')).toBeNull();
  });
});

describe('opening the source editor', () => {
  it('opens on click, preloaded with the current source', () => {
    const h = harnessOf('x^2');
    expect(openEditor(h.realized).value).toBe('x^2');
  });

  it('opens on Enter, because activating it is the only way to edit it', () => {
    const h = harnessOf('x');
    press(h.realized.dom, 'Enter');
    expect(sourceInput(h.realized)).not.toBeNull();
  });

  it('opens on Space as well', () => {
    const h = harnessOf('x');
    press(h.realized.dom, ' ');
    expect(sourceInput(h.realized)).not.toBeNull();
  });

  it('ignores a key that is neither', () => {
    const h = harnessOf('x');
    press(h.realized.dom, 'a');
    expect(sourceInput(h.realized)).toBeNull();
  });

  it('does not open a second editor while one is open', () => {
    const h = harnessOf('x');
    openEditor(h.realized);
    click(h.realized);
    expect(h.realized.dom.parentElement?.querySelectorAll('.notes-equation-editor-source')).toHaveLength(
      1,
    );
  });

  it('stays inert in a read-only view, which renders the same block', () => {
    const h = harnessOf('x', { editable: false });
    click(h.realized);
    expect(sourceInput(h.realized)).toBeNull();
  });

  it('is a tab stop only where the stop leads somewhere', () => {
    expect(harnessOf('x').realized.dom.tabIndex).toBe(0);
    // A read-only mount opens no editor, so landing on it is a detour into
    // nothing rather than the one keyboard route to the source.
    expect(harnessOf('x', { editable: false }).realized.dom.tabIndex).toBe(-1);
  });
});

describe('resolving an edit', () => {
  it('commits on Enter, changing only the source', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    input.value = 'y^2';
    press(input, 'Enter');
    expect(h.dispatched).toHaveLength(1);
    expect(h.liveLatex()).toBe('y^2');
    expect(h.liveNode().attrs.sid).toBe('s0001');
  });

  it('keeps what was there on Escape, and dispatches nothing', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    input.value = 'y';
    press(input, 'Escape');
    expect(h.dispatched).toHaveLength(0);
    expect(h.liveLatex()).toBe('x');
  });

  it('commits invalid source verbatim rather than correcting it', () => {
    const h = harnessOf('');
    const input = openEditor(h.realized);
    input.value = '\\frac{';
    press(input, 'Enter');
    expect(h.liveLatex()).toBe('\\frac{');
  });

  it('gives focus back to the document once the editor resolves', () => {
    const h = harnessOf('x');
    const input = openEditor(h.realized);
    input.value = 'y';
    press(input, 'Enter');
    expect(h.focus).toHaveBeenCalled();
  });

  it('lets the editor be opened again after it closed', () => {
    const h = harnessOf('x');
    const first = openEditor(h.realized);
    first.value = 'y';
    press(first, 'Enter');
    expect(openEditor(h.realized).value).toBe('y');
  });

  it('takes the editor away with the view', () => {
    const h = harnessOf('x');
    openEditor(h.realized);
    h.realized.destroy?.();
    expect(sourceInput(h.realized)).toBeNull();
  });
});
