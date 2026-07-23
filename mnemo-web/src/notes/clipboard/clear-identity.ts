/**
 * Strips block identity off a slice about to be pasted.
 *
 * A copied block keeps its `id` and `sid` on the clipboard so the payload can
 * still say which blocks it came from, but two blocks in one note may not share
 * either identifier. So every block node in a pasted slice has both cleared to
 * the empty string, and the identity plugin mints fresh ones the moment the
 * slice lands, the same path a split or an insert-above takes. Clearing is the
 * whole reason paste can lean on that plugin instead of minting here: an empty
 * identifier is the one signal it reacts to.
 *
 * The walk is total and recursive on purpose. A pasted two-column row carries
 * its cells and their blocks, each of which is its own identified block, so a
 * shallow pass over the top-level nodes would leave the nested ones colliding
 * with whatever they were copied from. Non-block nodes (a line, a text run, an
 * inline atom) hold no identity and are rebuilt only to carry their cleared
 * children.
 */

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';

import type { BlockRegistry } from '../editor/registry/build';

/** A copy of `slice` with every block node's `id` and `sid` blanked. */
export function withFreshIdentity(slice: Slice, registry: BlockRegistry): Slice {
  return new Slice(clearFragment(slice.content, registry), slice.openStart, slice.openEnd);
}

function clearFragment(fragment: Fragment, registry: BlockRegistry): Fragment {
  const cleared: PMNode[] = [];
  fragment.forEach((child) => cleared.push(clearNode(child, registry)));
  return Fragment.fromArray(cleared);
}

function clearNode(node: PMNode, registry: BlockRegistry): PMNode {
  // A text run's "content" is its characters; rebuilding it through create would
  // drop them, so leaves are returned untouched. They carry no identity anyway.
  if (node.isText) return node;

  const content = clearFragment(node.content, registry);
  const attrs = registry.byNodeName.has(node.type.name)
    ? { ...node.attrs, id: '', sid: '' }
    : node.attrs;
  return node.type.create(attrs, content, node.marks);
}
