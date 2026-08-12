/**
 * The tooltip marking, for DOM the editor builds by hand.
 *
 * Node views and the formatting toolbar are not React, so they cannot wrap themselves in
 * the Tooltip component. They must not fall back to `title` either: the host takes that
 * attribute off while it draws, and moving an attribute on a node ProseMirror is watching
 * is a document mutation as far as it is concerned.
 */
export function applyTooltip(element: HTMLElement, label: string, chord?: string | null): void {
  element.dataset.tooltip = label
  if (chord) element.dataset.tooltipChord = chord
  element.removeAttribute("title")
}
