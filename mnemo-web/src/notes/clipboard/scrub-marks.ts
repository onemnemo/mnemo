/**
 * Drops unsafe link marks from a slice about to be pasted.
 *
 * The link mark's render already refuses an unsafe href, so this is not what
 * stops the javascript: link from executing; it stops it from being stored. A
 * copied slice reaches the document by two routes that skip the HTML parser's
 * own href check, the in-memory buffer and the JSON payload a crafted clipboard
 * can carry, so an unsafe href could otherwise persist in the note (inert, but
 * dead weight and a trap for any future renderer that does not go through the
 * mark's toDOM). Stripping it here keeps saved content clean at the source.
 *
 * Only the link mark carries a URL; the other marks are booleans or swatch
 * tokens with nothing to abuse, so the walk touches nothing else.
 */

import { Fragment, type Mark, type Node as PMNode, Slice } from 'prosemirror-model';

import { isSafeUrl } from '../editor/schema/safe-url';

export function dropUnsafeLinks(slice: Slice): Slice {
  const content = scrubFragment(slice.content);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

function scrubFragment(fragment: Fragment): Fragment {
  const out: PMNode[] = [];
  let changed = false;
  fragment.forEach((child) => {
    const scrubbed = scrubNode(child);
    if (scrubbed !== child) changed = true;
    out.push(scrubbed);
  });
  return changed ? Fragment.fromArray(out) : fragment;
}

function scrubNode(node: PMNode): PMNode {
  const marks = safeMarks(node.marks);
  if (node.isText) return marks === node.marks ? node : node.mark(marks);

  const content = scrubFragment(node.content);
  if (content === node.content && marks === node.marks) return node;
  return node.type.create(node.attrs, content, marks);
}

function safeMarks(marks: readonly Mark[]): readonly Mark[] {
  if (!marks.some(isUnsafeLink)) return marks;
  return marks.filter((mark) => !isUnsafeLink(mark));
}

function isUnsafeLink(mark: Mark): boolean {
  return mark.type.name === 'link' && !isSafeUrl(String(mark.attrs.href));
}
