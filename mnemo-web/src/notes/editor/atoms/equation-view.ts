/**
 * The inline equation NodeView: draws the LaTeX, and opens a source editor when
 * activated.
 *
 * This is a `RealizedBlockView`, the same contract every block renderer returns,
 * because the registry keeps one `realizedViews` map for blocks and atoms alike
 * and the view layer adapts all of them into ProseMirror NodeViews through one path. An atom
 * has no editable content, so it returns no `contentDOM`; PM treats the whole
 * `dom` as opaque and leaves what is inside it to us.
 *
 * `update` re-renders only when the source actually changed. PM calls it on
 * every transaction that touches the node, including one that only re-marks it
 * bold, and re-running KaTeX on an unchanged string would throw away and
 * rebuild identical DOM on every keystroke nearby.
 *
 * ## Editing goes through a transaction, resolved at the live position
 *
 * The editor reports the new source; this view turns it into a `setNodeMarkup`
 * at `getPos()`, read *at commit time* rather than captured at open time,
 * because the atom can move while the editor is open. The rest of the attrs are
 * carried across so nothing but the LaTeX changes. Editing is the one place the
 * atom is not display-only, and it still never rewrites what the user typed,
 * invalid LaTeX commits verbatim and shows its error, rather than being
 * "corrected" into something the user did not write.
 *
 * ## Closing the popover goes through the shared focus scope
 *
 * `openTransientFocus` (`../focus`) is the contract every piece of
 * transient editor UI resolves through: commit and arrow-escape already leave
 * the selection somewhere correct, so they `release()` it; Escape has not, so
 * it `restore()`s the selection this popover opened with. This is the first
 * real consumer of that contract; the formatting toolbar and slash menu are next.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { asOwnUndoStep } from '../history';
import { openTransientFocus, type TransientFocusScope } from '../focus';
import { renderMath } from './katex';
import { mountEquationEditor, type ArrowEscape, type EquationEditorHandle } from './equation-editor';

function latexOf(node: PMNode): string {
  return String(node.attrs.latex ?? '');
}

export function equationView(args: RealizedBlockViewArgs<Record<string, unknown>>): RealizedBlockView {
  const view = args.view;
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

  let editor: EquationEditorHandle | null = null;
  let focusScope: TransientFocusScope | null = null;

  /** The node as it is *now*, at the live position, not the one captured at build. */
  function nodeAtPos(): PMNode | null {
    const pos = args.getPos();
    if (pos === undefined) return null;
    const node = view.state.doc.nodeAt(pos);
    return node && node.type === args.node.type ? node : null;
  }

  function commit(latex: string, escape?: ArrowEscape): void {
    const pos = args.getPos();
    if (pos === undefined) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== args.node.type) return;

    let tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex });
    if (escape) {
      // The atom is one position wide; land the caret just before or after it.
      const caret = escape === 'before' ? pos : pos + 1;
      tr = tr.setSelection(TextSelection.create(tr.doc, caret));
    }
    // Committing the source is one edit: a press takes the equation back to what
    // it said, not into whatever was typed around it before the popover opened.
    view.dispatch(asOwnUndoStep(tr));
  }

  function refocus(): void {
    (view as EditorView).focus();
  }

  function openEditor(): void {
    if (editor) return;
    const node = nodeAtPos();
    if (!node) return;

    // Captured before the popover takes DOM focus, so cancelling it can put the
    // selection back even if something else moved it while it was open.
    focusScope = openTransientFocus(view);

    editor = mountEquationEditor({
      initialLatex: latexOf(node),
      onCommit(latex) {
        editor = null;
        commit(latex);
        // commit() already leaves the selection where it belongs.
        focusScope?.release();
        focusScope = null;
        refocus();
      },
      onCancel() {
        editor = null;
        focusScope?.restore();
        focusScope = null;
      },
      onArrowEscape(direction, latex) {
        editor = null;
        // Committing already moves the selection past the atom.
        commit(latex, direction);
        focusScope?.release();
        focusScope = null;
        refocus();
      },
    });
    // Placement belongs to the editor chrome; for now the editor sits right after the atom.
    dom.after(editor.dom);
    editor.focus();
  }

  dom.addEventListener('click', openEditor);

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
    destroy() {
      dom.removeEventListener('click', openEditor);
      editor?.destroy();
      editor = null;
      // The view is going away with it; there is nothing left to restore into.
      focusScope = null;
    },
  };
}
