/**
 * The equation source editor: a focused input over the LaTeX, with a live
 * preview beside it.
 *
 * This is deliberately decoupled from the NodeView and from ProseMirror. It
 * knows how to edit a string and how to render a preview of it, and it reports
 * what the user decided through callbacks, commit, cancel, or navigate out. The
 * NodeView wires those to a transaction; the view layer decides where the thing is
 * positioned. Keeping the interaction here is what lets the whole editing
 * contract be tested without mounting an editor.
 *
 * ## The resolution is always one of three, and always final
 *
 * Enter commits, Escape cancels, an arrow at the text boundary navigates out.
 * Each closes the editor exactly once — a `closed` guard drops every event that
 * arrives after, so a stray keyup or a re-entrant callback cannot fire a second
 * resolution against a NodeView position that may no longer exist.
 *
 * ## Editing is lossless
 *
 * The input's value is the only source of truth and is never rewritten — not to
 * "fix" invalid LaTeX, not on commit. The preview renders through the same
 * `renderMath` the atom uses, which tolerates invalid input without throwing and
 * without touching what produced it, so committing broken LaTeX stores exactly
 * what was typed for the atom to show its error on and the user to repair.
 */

import { renderMath } from './katex';

export type ArrowEscape = 'before' | 'after';

export interface EquationEditorOptions {
  readonly initialLatex: string;
  /** Enter, or navigating out by arrow. The latex is the current text, verbatim. */
  onCommit(latex: string): void;
  /** Escape. The atom keeps whatever it had. */
  onCancel(): void;
  /**
   * An arrow key pressed at the matching edge of the text. Commits first — a
   * value already carries through when you navigate out of a field — then asks
   * the caller to place the caret on that side of the atom.
   */
  onArrowEscape(direction: ArrowEscape, latex: string): void;
}

export interface EquationEditorHandle {
  readonly dom: HTMLElement;
  /** Exposed for focus management and for driving the editor under test. */
  readonly input: HTMLInputElement;
  focus(): void;
  destroy(): void;
}

export function mountEquationEditor(options: EquationEditorOptions): EquationEditorHandle {
  const dom = document.createElement('span');
  dom.className = 'notes-equation-editor';
  // Never let ProseMirror treat the editor's own DOM as document content.
  dom.setAttribute('contenteditable', 'false');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'notes-equation-editor-source';
  input.value = options.initialLatex;
  // The source is code: none of the browser's prose assists belong here.
  input.spellcheck = false;
  input.autocomplete = 'off';

  const preview = document.createElement('span');
  preview.className = 'notes-equation-editor-preview';
  renderMath(preview, options.initialLatex, options.initialLatex);

  dom.append(input, preview);

  let closed = false;

  function close(): void {
    if (closed) return;
    closed = true;
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onKeydown);
    dom.remove();
  }

  function onInput(): void {
    // Live preview. The value stays exactly as typed; only the preview changes.
    renderMath(preview, input.value, input.value);
  }

  function atStart(): boolean {
    return input.selectionStart === 0 && input.selectionEnd === 0;
  }

  function atEnd(): boolean {
    const end = input.value.length;
    return input.selectionStart === end && input.selectionEnd === end;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (closed) return;

    switch (event.key) {
      case 'Enter': {
        // A source line is single-line; Enter is commit, never a newline.
        event.preventDefault();
        const latex = input.value;
        close();
        options.onCommit(latex);
        return;
      }
      case 'Escape': {
        event.preventDefault();
        close();
        options.onCancel();
        return;
      }
      case 'ArrowLeft': {
        // Only escapes from a collapsed caret at the very start; anywhere else
        // the arrow moves within the text as normal.
        if (!atStart()) return;
        event.preventDefault();
        const latex = input.value;
        close();
        options.onArrowEscape('before', latex);
        return;
      }
      case 'ArrowRight': {
        if (!atEnd()) return;
        event.preventDefault();
        const latex = input.value;
        close();
        options.onArrowEscape('after', latex);
        return;
      }
      default:
        return;
    }
  }

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);

  return {
    dom,
    input,
    focus() {
      input.focus();
      // Caret at the end: editing an existing equation usually means appending.
      const end = input.value.length;
      input.setSelectionRange(end, end);
    },
    destroy: close,
  };
}
