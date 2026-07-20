/**
 * The inline equation NodeView: draws the LaTeX, nothing more (for now).
 *
 * This is a `RealizedBlockView`, the same contract every block renderer returns,
 * because the registry keeps one `realizedViews` map for blocks and atoms alike
 * and the view layer adapts all of them into ProseMirror NodeViews through one path. An atom
 * has no editable content, so it returns no `contentDOM`; PM treats the whole
 * `dom` as opaque and leaves what is inside it to us.
 *
 * `update` re-renders only when the source actually changed. PM calls it on
 * every transaction that touches the node — including one that only re-marks it
 * bold — and re-running KaTeX on an unchanged string would throw away and
 * rebuild identical DOM on every keystroke nearby.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { renderMath } from './katex';

function latexOf(node: PMNode): string {
  return String(node.attrs.latex ?? '');
}

export function equationView(args: RealizedBlockViewArgs<Record<string, unknown>>): RealizedBlockView {
  const dom = document.createElement('span');
  dom.className = 'notes-atom notes-equation';
  // `contenteditable=false` keeps the caret from ever landing inside the KaTeX
  // DOM. The node is already `atom: true` in the schema, so this is belt and
  // braces, but a stray editable descendant is exactly how a "one caret
  // position" atom grows a second one. Set as an attribute rather than the IDL
  // property: it is what ProseMirror reads, and not every DOM reflects the two.
  dom.setAttribute('contenteditable', 'false');

  let rendered = latexOf(args.node);
  renderMath(dom, rendered, rendered);

  return {
    dom,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      const latex = latexOf(node);
      if (latex !== rendered) {
        rendered = latex;
        renderMath(dom, latex, latex);
      }
      return true;
    },
  };
}
