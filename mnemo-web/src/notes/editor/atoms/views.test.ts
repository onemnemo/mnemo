// @vitest-environment jsdom

/**
 * The atom NodeViews render through the real assembled schema, so these tests
 * cover the composition wiring (`withAtomViews`) as well as the views.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import katex from 'katex';
import { createEditorSchema } from '../schema';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { fallbackClass } from './katex';

const { schema, registry } = createEditorSchema();

/**
 * The realized view for a node, from the registry the app actually builds.
 *
 * The rendering is what these cover, but a state and a position go in as well:
 * the equation view reads both when it is built, to answer whether it is the
 * atom an insert just asked to open. A fuller args, with a dispatch to record,
 * is assembled where the editing wiring is under test.
 */
function viewOf(node: PMNode): RealizedBlockView {
  const factory = registry.realizedViews.get(node.type.name);
  if (!factory) throw new Error(`no realized view for ${node.type.name}`);
  const view = { state: EditorState.create({ schema }), editable: true };
  return factory({ node, view, getPos: () => 0 } as unknown as RealizedBlockViewArgs<
    Record<string, unknown>
  >);
}

function equation(latex: string): PMNode {
  return schema.nodes.equationSpan.create({ latex });
}

function fraction(numerator: number, denominator: number): PMNode {
  return schema.nodes.fractionSpan.create({ numerator, denominator });
}

describe('the equation view', () => {
  it('renders KaTeX inline for valid LaTeX', () => {
    const view = viewOf(equation('x^2'));
    expect(view.dom.querySelector('.katex')).not.toBeNull();
    // The visual HTML layer specifically, not just any KaTeX wrapper, a
    // mathml-only render would produce no on-screen equation.
    expect(view.dom.querySelector('.katex-html')).not.toBeNull();
    expect(view.dom.classList.contains(fallbackClass)).toBe(false);
    // An inline atom must not render in display mode, which centers the math on
    // its own line inside a `.katex-display` wrapper.
    expect(view.dom.querySelector('.katex-display')).toBeNull();
  });

  it('exposes the source as the accessible text', () => {
    const view = viewOf(equation('\\alpha + \\beta'));
    expect(view.dom.getAttribute('role')).toBe('math');
    expect(view.dom.getAttribute('aria-label')).toBe('\\alpha + \\beta');
  });

  it('keeps the caret out of the rendered math', () => {
    const view = viewOf(equation('x'));
    expect(view.dom.getAttribute('contenteditable')).toBe('false');
  });

  it('renders invalid LaTeX in place without throwing, and never rewrites the source', () => {
    const node = equation('\\frac{');
    expect(() => viewOf(node)).not.toThrow();
    const view = viewOf(node);
    // KaTeX's own error handling drew something in place; the catch fallback did
    // not fire. This is what `throwOnError: false` buys, an error span, not a
    // thrown exception the view has to mop up.
    expect(view.dom.innerHTML.length).toBeGreaterThan(0);
    expect(view.dom.classList.contains(fallbackClass)).toBe(false);
    // Lossless: the view is display-only, so the source attribute is untouched.
    expect(node.attrs.latex).toBe('\\frac{');
    expect(view.dom.getAttribute('aria-label')).toBe('\\frac{');
  });

  it('falls back to plain source when KaTeX throws outright', () => {
    // throwOnError:false handles ParseErrors; this stands in for the structural
    // throws it does not catch (deep recursion, internal assertions). katex.ts
    // imports the same module object, so the spy reaches the call it makes.
    const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      const view = viewOf(equation('x^2'));
      expect(view.dom.classList.contains(fallbackClass)).toBe(true);
      expect(view.dom.textContent).toBe('x^2');
    } finally {
      spy.mockRestore();
    }
  });

  it('clears the fallback marker once a later render succeeds', () => {
    const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
      throw new Error('boom');
    });
    const view = viewOf(equation('bad'));
    expect(view.dom.classList.contains(fallbackClass)).toBe(true);
    spy.mockRestore();
    // Same host, now editing to something that renders, the marker must go.
    view.update?.(equation('x'));
    expect(view.dom.classList.contains(fallbackClass)).toBe(false);
    expect(view.dom.querySelector('.katex')).not.toBeNull();
  });

  it('re-renders when the source changes', () => {
    const view = viewOf(equation('a'));
    expect(view.dom.getAttribute('aria-label')).toBe('a');
    const changed = view.update?.(equation('b'));
    expect(changed).toBe(true);
    expect(view.dom.getAttribute('aria-label')).toBe('b');
  });

  it('leaves the rendered DOM in place when the source is unchanged', () => {
    const view = viewOf(equation('a'));
    const first = view.dom.firstChild;
    view.update?.(equation('a'));
    expect(view.dom.firstChild).toBe(first);
  });

  it('asks for a rebuild when handed a different node type', () => {
    const view = viewOf(equation('a'));
    expect(view.update?.(fraction(1, 2))).toBe(false);
  });
});

describe('the fraction view', () => {
  it('renders a fraction with n/d as the accessible text', () => {
    const view = viewOf(fraction(1, 2));
    expect(view.dom.querySelector('.katex')).not.toBeNull();
    expect(view.dom.getAttribute('aria-label')).toBe('1/2');
  });

  it('clamps a non-positive denominator so it still draws', () => {
    const view = viewOf(fraction(3, 0));
    expect(view.dom.getAttribute('aria-label')).toBe('3/1');
    expect(view.dom.classList.contains(fallbackClass)).toBe(false);
  });

  it('re-renders on a numerator change', () => {
    const view = viewOf(fraction(1, 2));
    view.update?.(fraction(5, 2));
    expect(view.dom.getAttribute('aria-label')).toBe('5/2');
  });

  it('asks for a rebuild when handed a different node type', () => {
    const view = viewOf(fraction(1, 2));
    expect(view.update?.(equation('a'))).toBe(false);
  });

  it('falls back to n/d, not its \\frac source, when KaTeX throws', () => {
    const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      const view = viewOf(fraction(1, 2));
      expect(view.dom.classList.contains(fallbackClass)).toBe(true);
      // The reader sees the fraction as written, never the internal \frac{}{}.
      expect(view.dom.textContent).toBe('1/2');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the composed registry', () => {
  it('exposes a realized view for both atoms', () => {
    expect(registry.realizedViews.has('equationSpan')).toBe(true);
    expect(registry.realizedViews.has('fractionSpan')).toBe(true);
  });

  it('leaves the atoms text projection intact after composition', () => {
    const equationModule = registry.inlines.find((m) => m.spanKind === 'equation');
    expect(equationModule?.projectText(equation('E=mc^2'))).toBe('E=mc^2');
  });
});
