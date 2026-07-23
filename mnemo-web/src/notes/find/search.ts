/**
 * Find over the canonical document projection.
 *
 * Find searches the same flattened text the AI read surface, word count and the
 * outline all consume (`projectDocument`), never the DOM. That is not an
 * optimization, it is a correctness requirement: off-screen blocks are skipped
 * by `content-visibility: auto` and are absent from a native find, so a find
 * that walked the DOM would miss most of a large note. Searching the projection
 * finds every block whether it has ever been on screen or not.
 *
 * The projection deliberately covers more than prose. Code source and image
 * captions are ordinary line text and are searched and replaced as text ranges.
 * Equation LaTeX is the one exception: a block equation stores its source in an
 * attribute rather than as caret-addressable text, so its match is `attr`-backed
 * and its replace rewrites the attribute rather than a document range. Inline
 * equations fold their LaTeX into the surrounding prose projection, so a query
 * that lands inside one collapses to a zero-width range and is dropped rather
 * than mangling the atom.
 *
 * Everything here is a pure function of the projection. Nothing touches an
 * `EditorView`, dispatches a transaction, or reads a clock.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { BlockRegistry } from '../editor/registry/build';
import {
  documentPositionOf,
  projectDocument,
  type DocumentProjection,
} from '../editor/projection/document';
import type { AiSegmentKind } from '../editor/registry/types';

export interface FindOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
}

/** A range inside a block's own segment text, in text offsets. */
export interface LocalRange {
  readonly start: number;
  readonly length: number;
}

export interface FindMatch {
  /** The owning block's short id. Stable across edits that do not delete it. */
  readonly sid: string;
  readonly kind: AiSegmentKind;
  /** Absolute position of the owning block node. */
  readonly blockPos: number;
  /**
   * `text` when the match is a real document range (prose, code, image caption).
   * `attr` when it lives in a node attribute (block-equation LaTeX), where the
   * range below is the whole block node rather than a text span.
   */
  readonly backing: 'text' | 'attr';
  /** Match range as ProseMirror positions. For `attr`, the block node's range. */
  readonly from: number;
  readonly to: number;
  /** Where the match sits inside the owning segment's text. */
  readonly localRange: LocalRange;
  /** The exact text that matched, preserving the document's own casing. */
  readonly exactText: string;
}

/** A match tagged with the note identity it was computed against. */
export interface FindResult extends FindMatch {
  readonly noteSid: string;
  /** The persisted note version the match was computed against. */
  readonly ver: number;
}

/**
 * Projections keyed by document identity.
 *
 * A ProseMirror document is immutable, so an edit anywhere produces a new `doc`
 * object and every untouched search of the same `doc` is a cache hit. This is
 * what keeps a keystroke in the find box from re-walking the whole document: the
 * projection is reused, and only the string scan below re-runs. Re-projecting is
 * O(document); re-scanning a cached string is not, and it is never the whole
 * document tree.
 */
const projectionCache = new WeakMap<PMNode, DocumentProjection>();

export function projectionOf(doc: PMNode, registry: BlockRegistry): DocumentProjection {
  const cached = projectionCache.get(doc);
  if (cached) return cached;
  const projection = projectDocument(doc, registry);
  projectionCache.set(doc, projection);
  return projection;
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * A match is whole-word when neither the character before it nor after it is a
 * word character. Mirrors the desktop's `IsWholeWordBoundary`, whose word class
 * is letter-or-digit-or-underscore.
 */
function isWholeWordBoundary(text: string, start: number, length: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = start + length < text.length ? text[start + length] : '';
  return !(before !== '' && isWordChar(before)) && !(after !== '' && isWordChar(after));
}

/**
 * Case-insensitive index-of that never allocates a folded copy of the haystack.
 *
 * `String.prototype.toLowerCase` is not length-preserving for every code point
 * (a dotted capital I folds to two units), so searching a lowercased copy and
 * reusing the index against the original would drift the match off its real
 * position. Comparing character by character keeps every returned offset exact
 * in the original text, which is what the position mapping downstream depends
 * on.
 */
function indexOfInsensitive(text: string, query: string, from: number): number {
  const n = text.length;
  const m = query.length;
  for (let i = from; i <= n - m; i++) {
    let matched = true;
    for (let j = 0; j < m; j++) {
      const a = text[i + j];
      const b = query[j];
      if (a !== b && a.toLowerCase() !== b.toLowerCase()) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

/** Every offset in `text` where `query` occurs, honoring the search options. */
function* matchOffsets(text: string, query: string, options: FindOptions): Generator<number> {
  if (text.length === 0 || query.length === 0) return;

  let start = 0;
  while (start <= text.length - query.length) {
    const idx = options.caseSensitive
      ? text.indexOf(query, start)
      : indexOfInsensitive(text, query, start);
    if (idx < 0) return;
    if (!options.wholeWord || isWholeWordBoundary(text, idx, query.length)) yield idx;
    // Advance past this match so overlapping occurrences are not double-counted,
    // matching the desktop's non-overlapping scan.
    start = idx + Math.max(query.length, 1);
  }
}

/**
 * Every match of `query` in the document, in document order.
 *
 * The scan is per segment rather than over the joined `projection.text`, so a
 * query never spans a block boundary and every match belongs to exactly one
 * block. That is what lets a result carry a single `sid` and a block-local range
 * that a later replace can revalidate.
 */
export function searchDocument(
  projection: DocumentProjection,
  query: string,
  options: FindOptions,
  doc: PMNode,
): FindMatch[] {
  const matches: FindMatch[] = [];
  if (query.length === 0) return matches;

  const blockByPos = new Map(projection.blocks.map((block) => [block.pos, block]));

  for (const segment of projection.segments) {
    // A segment is text-backed when its text appears verbatim at its document
    // offset in the joined projection. A block equation's LaTeX does not (its
    // line projects as empty), which is the exact and general discriminator for
    // an attribute-backed segment without special-casing a block type.
    const textBacked = projection.text.startsWith(segment.text, segment.docOffset);

    for (const offset of matchOffsets(segment.text, query, options)) {
      const exactText = segment.text.slice(offset, offset + query.length);
      const localRange: LocalRange = { start: offset, length: query.length };

      if (textBacked) {
        const globalStart = segment.docOffset + offset;
        const from = documentPositionOf(projection, globalStart);
        const to = documentPositionOf(projection, globalStart + query.length);
        if (from === null || to === null) continue;
        // The projected text folds an inline atom's LaTeX in as characters, but
        // the atom is one caret position holding no document text. A match that
        // touches an atom (fully inside it, or a query equal to or spanning the
        // whole atom) therefore maps to a range whose real document text is not
        // the matched text. There is nothing editable to highlight or replace,
        // so it is dropped rather than surfaced as an unactionable hit. A
        // collapsed range fails this the same way, so it also covers that case.
        if (from >= to) continue;
        if (doc.textBetween(from, to) !== exactText) continue;
        matches.push({
          sid: segment.sid,
          kind: segment.kind,
          blockPos: segment.blockPos,
          backing: 'text',
          from,
          to,
          localRange,
          exactText,
        });
      } else {
        const block = blockByPos.get(segment.blockPos);
        if (!block) continue;
        matches.push({
          sid: segment.sid,
          kind: segment.kind,
          blockPos: segment.blockPos,
          backing: 'attr',
          from: segment.blockPos,
          to: segment.blockPos + block.node.nodeSize,
          localRange,
          exactText,
        });
      }
    }
  }

  return matches;
}

/** Tags matches with the note identity a stale check will compare against. */
export function withIdentity(
  matches: readonly FindMatch[],
  identity: { readonly noteSid: string; readonly ver: number },
): FindResult[] {
  return matches.map((match) => ({ ...match, noteSid: identity.noteSid, ver: identity.ver }));
}

/**
 * Drops results computed against a different persisted version.
 *
 * A landed save or an adopted server version moves `ver`; a result carrying the
 * old one describes a document that is no longer authoritative and must not be
 * navigated to or replaced. Local edits do not move `ver` (they move the
 * revision), and those are handled by revalidating the exact text at replace
 * time, not by this filter.
 */
export function dropStale(results: readonly FindResult[], currentVer: number): FindResult[] {
  return results.filter((result) => result.ver === currentVer);
}
