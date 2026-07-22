/**
 * The one place KaTeX is called.
 *
 * Rendering math is display only, it reads the atom's source and writes DOM,
 * and it never touches the source. That is what "lossless invalid-LaTeX
 * fallback" means: whatever the user typed stays exactly as it is in the node's
 * attribute, and this function's only job is to draw *something* for it that a
 * later edit can still recover from. A render that threw, or that rewrote the
 * source to something parseable, would break that.
 *
 * ## Two layers of tolerance
 *
 * KaTeX's own `throwOnError: false` turns a parse error into a red error span
 * that still contains the source, which is the common case and the one that
 * needs no help. The `try/catch` is for the rest: KaTeX can throw on things
 * that are not `ParseError` (a stack overflow on pathological nesting, an
 * internal assertion), and an inline atom in the middle of a paragraph must not
 * take the paragraph down with it. On any throw the source is shown as plain
 * text, ugly, but readable and repairable.
 *
 * ## Accessibility carries the source, not the rendering
 *
 * The host gets `role="math"` and an `aria-label` of the source. KaTeX can emit
 * MathML, but the source is what the user wrote and what the AI surface and find
 * address the equation by, so that is what a screen reader should hear. An
 * `aria-label` on the host makes assistive tech read the label instead of
 * walking the rendered subtree, so the two never double up.
 */

import katex from 'katex';

/** Marks a host whose math could not be rendered and fell back to plain source. */
export const fallbackClass = 'notes-atom-fallback';

/**
 * Renders `source` into `host`, replacing whatever was there. Never throws, and
 * never reads back from or writes to anything but `host`.
 *
 * `label` is the accessible text, the equation's LaTeX, or a fraction's
 * `n/d`. It is separate from `source` because a fraction renders from a
 * `\frac{}{}` string it never shows the user.
 */
export function renderMath(host: HTMLElement, source: string, label: string): void {
  host.setAttribute('role', 'math');
  host.setAttribute('aria-label', label);
  host.classList.remove(fallbackClass);

  try {
    host.innerHTML = katex.renderToString(source, {
      throwOnError: false,
      displayMode: false,
      output: 'html',
    });
  } catch {
    // Not a KaTeX ParseError, those are handled above and render in place.
    // Something structural threw, so draw the source verbatim rather than let
    // one atom blank the block it sits in.
    host.classList.add(fallbackClass);
    host.textContent = label;
  }
}
