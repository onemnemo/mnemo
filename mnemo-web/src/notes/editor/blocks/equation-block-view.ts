/**
 * The block equation's renderer: draws the LaTeX, and opens a source editor when
 * activated.
 *
 * This is the first block-level realized view in the port. Until now only the
 * inline atoms had one and every block rendered through its schema `toDOM`,
 * which for this type produced an empty `div`, a block that took up no room and
 * showed nothing. That is why the block was never offered anywhere: nothing
 * discoverable should create an object the user cannot then see or repair.
 *
 * ## No `contentDOM`, on purpose
 *
 * The node still has a line, every block on the wire does, but an equation
 * renders entirely from its `latex` attr and its spans are force-cleared on the
 * way in. Handing ProseMirror a `contentDOM` would put an editable caret inside
 * content nothing ever reads back out. Divider is drawn the same way and for the
 * same reason.
 *
 * The consequence is that the position inside the line has no DOM to sit at, so
 * whatever creates one of these has to leave the caret somewhere else. That is
 * `insertAtomicBlock`'s job, not this file's.
 *
 * ## Editing reuses the inline equation's editor
 *
 * `mountEquationEditor` knows how to edit a LaTeX string and nothing about
 * ProseMirror, so both the inline atom and this block drive it and get the same
 * Enter-commits, Escape-cancels, arrow-navigates-out contract. The desktop's
 * block flyout has no such contract, it writes every keystroke straight through
 * and treats Escape and Enter alike, so there is nothing to cancel back to. The
 * shared contract is the better behaviour and keeps the two equation surfaces
 * from feeling like different features.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { asOwnUndoStep } from '../history';
import { openTransientFocus, type TransientFocusScope } from '../focus';
import { fallbackClass, renderMath } from '../atoms/katex';
import { mountEquationEditor, type EquationEditorHandle } from '../atoms/equation-editor';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';

const ROOT = 'notes-equation-block';

/** Reads the active bundle at call time, so it follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

/** The flyout's commit label, the desktop's "Done ↵". */
function doneLabel(): string {
  return `${createTranslate(useI18nStore.getState().bundle)('Common', 'Done')} ↵`;
}

function latexOf(node: PMNode): string {
  return String(node.attrs.latex ?? '');
}

export function equationBlockView(
  args: RealizedBlockViewArgs<Record<string, unknown>>,
): RealizedBlockView {
  const { view } = args;
  const dom = document.createElement('div');
  dom.className = ROOT;
  // The node is not an atom in the schema, so without this the caret can be
  // dropped into the rendered KaTeX, which is display output rather than
  // content and has no position to map back to.
  dom.setAttribute('contenteditable', 'false');
  // Reachable by keyboard, because activating it is the only way to edit it.
  dom.tabIndex = 0;

  let rendered: string | null = null;
  let editor: EquationEditorHandle | null = null;
  let focusScope: TransientFocusScope | null = null;

  function draw(latex: string): void {
    rendered = latex;
    if (latex.length === 0) {
      // An equation with no source has nothing to typeset, and an empty block
      // is indistinguishable from a missing one. Say what it is and how to
      // fill it, which is what the desktop draws here too.
      dom.classList.add(`${ROOT}-empty`);
      // Emptying the source clears a previous render's failure with it.
      dom.classList.remove(fallbackClass);
      dom.removeAttribute('role');
      dom.textContent = translate('EquationPlaceholder');
      dom.setAttribute('aria-label', translate('Equation'));
      return;
    }
    dom.classList.remove(`${ROOT}-empty`);
    renderMath(dom, latex, latex, { display: true });
  }

  draw(latexOf(args.node));

  /** The node as it is now, at the live position, not the one captured at build. */
  function nodeAtPos(): PMNode | null {
    const pos = args.getPos();
    if (pos === undefined) return null;
    const node = view.state.doc.nodeAt(pos);
    return node && node.type === args.node.type ? node : null;
  }

  function commit(latex: string): void {
    const pos = args.getPos();
    if (pos === undefined) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== args.node.type) return;
    // One edit: a single undo takes the equation back to what it said, rather
    // than unwinding into whatever happened before the editor opened.
    view.dispatch(asOwnUndoStep(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex })));
  }

  function closeEditor(): void {
    editor?.destroy();
    editor = null;
  }

  function openEditor(): void {
    // A read-only editor renders the same views; without this the note preview
    // would offer to edit an equation it cannot save.
    if (!view.editable || editor) return;
    const node = nodeAtPos();
    if (!node) return;

    // Captured before the editor takes DOM focus, so cancelling can put the
    // selection back even if something else moved it while it was open.
    focusScope = openTransientFocus(view);

    const original = latexOf(node);
    editor = mountEquationEditor({
      initialLatex: original,
      anchor: dom,
      placeholder: translate('EquationFlyoutPlaceholder'),
      doneLabel: doneLabel(),
      // The block itself is the preview: every keystroke redraws it, the
      // desktop's write-through behaviour, without touching the document.
      onChange(latex) {
        draw(latex);
      },
      onCommit(latex) {
        editor = null;
        commit(latex);
        focusScope?.release();
        focusScope = null;
        view.focus();
      },
      onCancel() {
        editor = null;
        // The live preview drew every keystroke; cancelling puts the stored
        // source back on screen.
        draw(latexOf(nodeAtPos() ?? args.node));
        focusScope?.restore();
        focusScope = null;
      },
      // A block equation has no text either side to arrow out into, so an arrow
      // at the edge commits and stops, the same as Enter. Only the inline atom
      // has somewhere to go.
      onArrowEscape(_direction, latex) {
        editor = null;
        commit(latex);
        focusScope?.release();
        focusScope = null;
        view.focus();
      },
    });
    editor.focus();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Only the host itself, never a key that bubbled out of the open editor.
    if (event.target !== dom) return;
    event.preventDefault();
    openEditor();
  }

  dom.addEventListener('click', openEditor);
  dom.addEventListener('keydown', onKeyDown);

  return {
    dom,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      const latex = latexOf(node);
      // Re-typesetting an unchanged string would throw away and rebuild
      // identical DOM on every transaction that touched the block.
      if (latex !== rendered) draw(latex);
      return true;
    },
    // No contentDOM: everything inside is KaTeX output this view drew, and the
    // live preview redraws it outside a transaction. Selection records still
    // pass through.
    ignoreMutation(mutation) {
      return mutation.type !== 'selection';
    },
    destroy() {
      dom.removeEventListener('click', openEditor);
      dom.removeEventListener('keydown', onKeyDown);
      closeEditor();
      // The view is going away with it; there is nothing left to restore into.
      focusScope = null;
    },
  };
}
