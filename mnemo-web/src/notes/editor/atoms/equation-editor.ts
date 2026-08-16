/**
 * The equation source editor: the desktop's equation flyout, a floating card
 * under the equation with a monospace LaTeX field and a Done button.
 *
 * This is deliberately decoupled from the NodeView and from ProseMirror. It
 * knows how to edit a string and it reports what the user decided through
 * callbacks, commit, cancel, or navigate out; the NodeView wires those to a
 * transaction. Keeping the interaction here is what lets the whole editing
 * contract be tested without mounting an editor.
 *
 * ## The card lives on `document.body`, never inside the editor's DOM
 *
 * The first version mounted itself next to the equation, inside ProseMirror's
 * content. The editor's MutationObserver reads foreign DOM there as document
 * corruption and strips it on the next redraw, so the editor vanished the
 * moment it opened. Body-level and viewport-positioned, like the formatting
 * toolbar and the slash menu, and for the same reasons.
 *
 * ## The resolution is always one of four, and always final
 *
 * Enter or the Done button commits, Escape cancels, an arrow at the text
 * boundary navigates out, and a pointer landing outside the card commits,
 * the desktop flyout is light-dismissed and writes through live, so what was
 * typed survives the dismissal there too. Each closes the editor exactly
 * once; a `closed` guard drops every event that arrives after.
 *
 * ## Editing is lossless and previewed live
 *
 * The input's value is the only source of truth and is never rewritten, not
 * to "fix" invalid LaTeX, not on commit. Every keystroke reports through
 * `onChange`, which is how the equation itself live-updates while the card is
 * open, exactly the desktop's write-through preview, with cancel restored by
 * the caller.
 */

export type ArrowEscape = 'before' | 'after';

export interface EquationEditorOptions {
  readonly initialLatex: string;
  /** Positions the card under this element; omitted, the caller places the card. */
  readonly anchor?: HTMLElement;
  /** Ghost text for an empty source field. */
  readonly placeholder?: string;
  /** The commit button's label; falls back to a plain return glyph. */
  readonly doneLabel?: string;
  /** Every keystroke, verbatim. The live preview hook; never a resolution. */
  onChange?(latex: string): void;
  /** Enter, the Done button, or a pointer outside the card. The latex is the current text, verbatim. */
  onCommit(latex: string): void;
  /** Escape. The atom keeps whatever it had; the caller unwinds the live preview. */
  onCancel(): void;
  /**
   * An arrow key pressed at the matching edge of the text. Commits first, a
   * value already carries through when you navigate out of a field, then asks
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

/** Below the anchor, left-aligned to it, clamped into the viewport. */
function placeAt(dom: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const width = dom.offsetWidth;
  const height = dom.offsetHeight;
  dom.style.left = `${String(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)))}px`;
  let top = rect.bottom + 6;
  // No room below: flip above, the same way the toolbar's popover flips.
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  dom.style.top = `${String(top)}px`;
}

export function mountEquationEditor(options: EquationEditorOptions): EquationEditorHandle {
  const dom = document.createElement('div');
  dom.className = 'notes-equation-flyout';
  // Never let ProseMirror treat the editor's own DOM as document content.
  dom.setAttribute('contenteditable', 'false');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'notes-equation-editor-source';
  input.value = options.initialLatex;
  if (options.placeholder) input.placeholder = options.placeholder;
  // The source is code: none of the browser's prose assists belong here.
  input.spellcheck = false;
  input.autocomplete = 'off';

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'notes-equation-flyout-done';
  done.textContent = options.doneLabel ?? '↵';

  dom.append(input, done);

  let closed = false;

  function close(): void {
    if (closed) return;
    closed = true;
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onKeydown);
    done.removeEventListener('click', onDone);
    document.removeEventListener('pointerdown', onOutside, true);
    dom.remove();
  }

  function onInput(): void {
    // Live preview through the caller. The value stays exactly as typed.
    options.onChange?.(input.value);
  }

  function commitNow(): void {
    const latex = input.value;
    close();
    options.onCommit(latex);
  }

  function onDone(): void {
    if (closed) return;
    commitNow();
  }

  /**
   * A pointer landing outside the card resolves it, matching the desktop
   * flyout's light dismissal. Commit rather than cancel: the desktop writes
   * every keystroke through, so dismissal keeps the typed source there too.
   * The click itself is not swallowed, it goes on to do whatever it was
   * aimed at.
   */
  function onOutside(event: PointerEvent): void {
    if (closed) return;
    if (event.target instanceof Node && dom.contains(event.target)) return;
    commitNow();
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
        commitNow();
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
  done.addEventListener('click', onDone);
  // Capture phase, so a click that something else swallows still resolves the
  // card. Deferred registration is unnecessary: the opening click already
  // happened by the time this mount runs.
  document.addEventListener('pointerdown', onOutside, true);

  document.body.appendChild(dom);
  if (options.anchor) placeAt(dom, options.anchor);

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
