/**
 * The inline fraction NodeView.
 *
 * A fraction has zero uses in the corpus, so it gets a renderer and nothing
 * else, no creation affordance, no editing popover. It has to draw, because a
 * note that already contains one (from another client, or a future feature)
 * must open and round-trip without the fraction turning into a hole. KaTeX's
 * `\frac` is the same renderer the equation atom uses, so the two never drift.
 *
 * The accessible label is `n/d`, matching the atom's text projection so find and
 * a screen reader address it the same way, not the `\frac{}{}` string, which is
 * an implementation detail the user never wrote.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { renderMath } from './katex';

interface FractionParts {
  readonly numerator: number;
  readonly denominator: number;
}

function partsOf(node: PMNode): FractionParts {
  return {
    numerator: Number(node.attrs.numerator) || 0,
    // A zero or negative denominator is unrenderable; the serializer clamps on
    // the way in, and this clamps again so a fraction reached by any other path
    // still draws instead of producing a KaTeX division artifact.
    denominator: Number(node.attrs.denominator) > 0 ? Number(node.attrs.denominator) : 1,
  };
}

function labelOf(parts: FractionParts): string {
  return `${String(parts.numerator)}/${String(parts.denominator)}`;
}

function sourceOf(parts: FractionParts): string {
  return `\\frac{${String(parts.numerator)}}{${String(parts.denominator)}}`;
}

export function fractionView(args: RealizedBlockViewArgs<Record<string, unknown>>): RealizedBlockView {
  const dom = document.createElement('span');
  dom.className = 'notes-atom notes-fraction';
  dom.setAttribute('contenteditable', 'false');

  let current = partsOf(args.node);
  renderMath(dom, sourceOf(current), labelOf(current));

  return {
    dom,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      const next = partsOf(node);
      if (next.numerator !== current.numerator || next.denominator !== current.denominator) {
        current = next;
        renderMath(dom, sourceOf(next), labelOf(next));
      }
      return true;
    },
  };
}
