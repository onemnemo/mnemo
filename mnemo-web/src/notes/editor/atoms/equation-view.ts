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
 * ## An equation with no source is drawn, not left blank
 *
 * KaTeX typesets an empty source to an empty span, which inside a line of prose
 * is zero pixels wide: the atom is in the document, holds a caret position, and
 * has nothing to aim a pointer at. So a blank source draws a placeholder chip
 * instead, the same answer the block equation gives, and a source that is blank
 * when the editor closes takes the atom out with it rather than leaving an
 * object in the line that says nothing.
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
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';
import { fallbackClass, renderMath } from './katex';
import { mountEquationEditor, type ArrowEscape, type EquationEditorHandle } from './equation-editor';
import { consumeOpenOnInsert, opensEditorAt } from './open-on-insert';

const ROOT = 'notes-equation';

function latexOf(node: PMNode): string {
  return String(node.attrs.latex ?? '');
}

/** A source KaTeX would typeset to nothing, so the atom has to draw itself. */
function isBlank(latex: string): boolean {
  return latex.trim().length === 0;
}

/** Reads the active bundle at call time, so it follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

/** The flyout's commit label, the desktop's "Done ↵". */
function doneLabel(): string {
  return `${createTranslate(useI18nStore.getState().bundle)('Common', 'Done')} ↵`;
}

export function equationView(args: RealizedBlockViewArgs<Record<string, unknown>>): RealizedBlockView {
  const view = args.view;
  const dom = document.createElement('span');
  dom.className = `notes-atom ${ROOT}`;
  // `contenteditable=false` keeps the caret from ever landing inside the KaTeX
  // DOM. The node is already `atom: true` in the schema, so this is belt and
  // braces, but a stray editable descendant is exactly how a "one caret
  // position" atom grows a second one. Set as an attribute rather than the IDL
  // property: it is what ProseMirror reads, and not every DOM reflects the two.
  dom.setAttribute('contenteditable', 'false');

  let rendered: string | null = null;
  let editor: EquationEditorHandle | null = null;
  let focusScope: TransientFocusScope | null = null;
  let destroyed = false;

  function draw(latex: string): void {
    rendered = latex;
    if (isBlank(latex)) {
      dom.classList.add(`${ROOT}-empty`);
      // Emptying the source clears a previous render's failure with it.
      dom.classList.remove(fallbackClass);
      // Not maths any more: the chip is a control, and naming it as a formula
      // would have a screen reader announce an equation that has none.
      dom.removeAttribute('role');
      dom.textContent = translate('Equation');
      dom.title = translate('EquationPlaceholder');
      dom.setAttribute('aria-label', translate('EquationPlaceholder'));
      return;
    }
    dom.classList.remove(`${ROOT}-empty`);
    dom.removeAttribute('title');
    renderMath(dom, latex, latex);
  }

  draw(latexOf(args.node));

  /** The node as it is *now*, at the live position, not the one captured at build. */
  function nodeAtPos(): PMNode | null {
    const pos = args.getPos();
    if (pos === undefined) return null;
    const node = view.state.doc.nodeAt(pos);
    return node && node.type === args.node.type ? node : null;
  }

  /**
   * Takes the atom back out, leaving the caret where it stood.
   *
   * One step, so a single undo brings back whatever the insert replaced instead
   * of resurrecting an equation the user declined to write.
   */
  function remove(): void {
    const pos = args.getPos();
    if (pos === undefined) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== args.node.type) return;
    const tr = view.state.tr.delete(pos, pos + node.nodeSize);
    view.dispatch(asOwnUndoStep(tr.setSelection(TextSelection.create(tr.doc, pos))));
  }

  function commit(latex: string, escape?: ArrowEscape): void {
    // Nothing to typeset and nothing to click: an atom left here would be a
    // position in the line the user cannot see, select or reopen. Every
    // resolution that keeps the source (Enter, Done, a click outside, an arrow
    // out) resolves to this when the source is blank.
    if (isBlank(latex)) {
      remove();
      return;
    }

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
    // A read-only editor renders the same views; without this the note preview
    // would offer to edit an equation it cannot save.
    if (!view.editable || editor) return;
    const node = nodeAtPos();
    if (!node) return;

    // Captured before the popover takes DOM focus, so cancelling it can put the
    // selection back even if something else moved it while it was open.
    focusScope = openTransientFocus(view);

    editor = mountEquationEditor({
      initialLatex: latexOf(node),
      // The card floats under the atom on document.body; mounted beside the
      // atom it would sit inside ProseMirror's content, which strips foreign
      // DOM on the next redraw.
      anchor: dom,
      placeholder: translate('EquationFlyoutPlaceholder'),
      doneLabel: doneLabel(),
      // The atom is its own live preview while the card is open.
      onChange(latex) {
        draw(latex);
      },
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
        const kept = latexOf(nodeAtPos() ?? args.node);
        if (isBlank(kept)) {
          // Restoring an empty source would put the invisible atom back, with
          // no way left to reach it. Cancelling an equation that never had one
          // means there is nothing to cancel back to.
          focusScope?.release();
          focusScope = null;
          remove();
          refocus();
          return;
        }
        // Undo the live preview: the atom goes back to its stored source.
        draw(kept);
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
    editor.focus();
  }

  dom.addEventListener('click', openEditor);

  const insertedAt = args.getPos();
  if (insertedAt !== undefined && opensEditorAt(view.state, insertedAt)) {
    // Deferred by a microtask: the view is still applying the transaction that
    // built this, and taking DOM focus mid-update loses it again to the
    // selection sync that follows.
    queueMicrotask(() => {
      if (destroyed) return;
      // Answered: a view rebuilt for this atom later must not open it again.
      if (opensEditorAt(view.state, insertedAt)) view.dispatch(consumeOpenOnInsert(view.state.tr));
      openEditor();
    });
  }

  return {
    dom,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      const latex = latexOf(node);
      if (latex !== rendered) draw(latex);
      return true;
    },
    // The atom's DOM is entirely KaTeX output this view drew, and the live
    // preview redraws it outside a transaction. Selection records still pass.
    ignoreMutation(mutation) {
      return mutation.type !== 'selection';
    },
    destroy() {
      destroyed = true;
      dom.removeEventListener('click', openEditor);
      editor?.destroy();
      editor = null;
      // The view is going away with it; there is nothing left to restore into.
      focusScope = null;
    },
  };
}
