/**
 * The pieces the restating passes share.
 *
 * A foreign table or list is rewritten, before parsing, into the marker
 * elements our schema has parse rules for. Both passes need the same two
 * things: the set of tags a line keeps as inline content, and a way to build
 * the marker elements themselves.
 */

/** Inline tags a line keeps as they stand; anything else in one is a wrapper. */
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  'A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'CODE', 'SPAN', 'FONT', 'SUB', 'SUP',
  'MARK', 'SMALL', 'ABBR', 'CITE', 'Q', 'TIME', 'VAR', 'KBD', 'SAMP',
]);

/** A `<div>` carrying one of the schema's marker attributes. */
export function markerDiv(attribute: string): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute(attribute, '');
  return element;
}

/** The line every block node opens with. */
export const emptyLine = (): HTMLElement => markerDiv('data-line');
