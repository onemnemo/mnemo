/**
 * The two inline atoms: an equation span and a fraction span.
 *
 * Both are atomic — one caret position no matter how long the LaTeX is — so
 * they cannot be marks, and neither owns a `BlockType`, so they cannot be
 * blocks. They are inline PM *nodes*.
 *
 * `marks: "_"` is the detail that makes bolding an equation work. It governs
 * what marks the node's *content* may carry, and separately PM allows any node
 * to carry marks of its own, so the atom picks up `strong` exactly like a text
 * span does. The Avalonia renderer already honours a styled equation, so this
 * is required parity rather than a nicety.
 *
 * **Style is not handled here.** These modules convert the atom's own data and
 * nothing else; the mapper owns the `TextStyle` <-> mark-array conversion for
 * every inline node, text spans and atoms alike. Doing it in one place is what
 * keeps a styled equation and a styled word from drifting apart, and it is why
 * `fromNode` returns the default style for the caller to replace.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { BlockSchema, InlineModule } from '../registry/types';
import { defaultTextStyle, type EquationSpan, type FractionSpan } from '../../model/types';

/** Shared by both atoms: inline, atomic, styleable, invisible to selection arithmetic. */
const atomBase = {
  inline: true,
  atom: true,
  group: 'inline',
  marks: '_',
} as const;

export const equationInline: InlineModule = {
  nodeName: 'equationSpan',
  spanKind: 'equation',
  node: {
    ...atomBase,
    attrs: { latex: { default: '' } },
    parseDOM: [
      {
        tag: 'span[data-equation]',
        getAttrs: (n) => ({ latex: (n as HTMLElement).getAttribute('data-equation') ?? '' }),
      },
    ],
    toDOM: (node) => ['span', { 'data-equation': String(node.attrs.latex) }],
  },
  serialize: {
    toNode: (span, schema) =>
      schema.nodes.equationSpan.create({ latex: (span as EquationSpan).latex }),
    fromNode: (node): EquationSpan => ({
      kind: 'equation',
      latex: String(node.attrs.latex ?? ''),
      style: { ...defaultTextStyle },
    }),
  },
  /**
   * The LaTeX source, not a rendered form. Find searching `\frac` should hit the
   * equation that contains it, and the AI surface addresses equations by source.
   */
  projectText: (node: PMNode) => String(node.attrs.latex ?? ''),
};

/** Zero uses in the corpus. Exists so the span kind cannot be silently dropped. */
export const fractionInline: InlineModule = {
  nodeName: 'fractionSpan',
  spanKind: 'fraction',
  node: {
    ...atomBase,
    attrs: { numerator: { default: 0 }, denominator: { default: 1 } },
    parseDOM: [
      {
        tag: 'span[data-fraction]',
        getAttrs: (n) => {
          const raw = (n as HTMLElement).getAttribute('data-fraction') ?? '';
          const [num, den] = raw.split('/');
          return { numerator: Number(num) || 0, denominator: Number(den) || 1 };
        },
      },
    ],
    toDOM: (node) => [
      'span',
      { 'data-fraction': `${String(node.attrs.numerator)}/${String(node.attrs.denominator)}` },
    ],
  },
  serialize: {
    toNode: (span, schema: BlockSchema) => {
      const fraction = span as FractionSpan;
      return schema.nodes.fractionSpan.create({
        numerator: fraction.numerator,
        // A zero or negative denominator is unrenderable. The parser already
        // clamps, but a fraction can also reach here from a command.
        denominator: fraction.denominator > 0 ? fraction.denominator : 1,
      });
    },
    fromNode: (node): FractionSpan => ({
      kind: 'fraction',
      numerator: Number(node.attrs.numerator) || 0,
      denominator: Number(node.attrs.denominator) || 1,
      style: { ...defaultTextStyle },
    }),
  },
  projectText: (node: PMNode) =>
    `${String(node.attrs.numerator)}/${String(node.attrs.denominator)}`,
};

export const inlineModules: readonly InlineModule[] = [equationInline, fractionInline];
