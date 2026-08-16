/**
 * The note's word count, off the one canonical text projection.
 *
 * There is exactly one number a note can honestly claim, and it is the token
 * count of the same flattened text that find, the outline and the AI read
 * surface all consume. Counting blocks a second way here would let the metadata
 * line and the search index disagree about how long a note is, which is the
 * whole class of drift `projectDocument` exists to make unrepresentable.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { BlockRegistry } from '../registry/build';
import { projectDocument } from './document';

/**
 * Words in a flattened document string: maximal non-whitespace runs.
 *
 * Equivalent to the desktop's `Split(null, RemoveEmptyEntries)` length, so a
 * note reports the same figure it did before the port. Runs, not a split, so
 * leading, trailing and repeated whitespace never mint an empty word.
 */
export function countWords(text: string): number {
  const runs = text.match(/\S+/g);
  return runs ? runs.length : 0;
}

/** The canonical word count: tokens in the document's canonical text projection. */
export function documentWordCount(doc: PMNode, registry: BlockRegistry): number {
  return countWords(projectDocument(doc, registry).text);
}
