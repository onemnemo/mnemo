/**
 * What gets sent to be checked, and how an answer finds its way back.
 *
 * Pure functions of the document. The unit is a segment of the canonical
 * projection the find plugin also consumes, so an offset resolved here lands
 * where find would put it rather than in a second, drifting coordinate space.
 *
 * Two kinds of character are blanked before a segment leaves: an inline code
 * span, which is a literal and not prose, and an inline atom, which projects
 * its LaTeX source into the surrounding text. Both are replaced with spaces
 * rather than removed, so every offset in the answer still indexes the segment
 * the caller holds, and the words either side of them are not glued together.
 *
 * A segment carries its own position function. The document-level
 * `documentPositionOf` walks from the start of the document and projects every
 * block it passes, which is the right shape for a one-off lookup and the wrong
 * one for an answer: a batch late in a long note would pay that walk twice for
 * every flagged word. The owning block is already known here, so the crossing
 * is `blockPos + positionOf(node, offset)` and costs nothing beyond the block's
 * own line.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { atomProjector, lineOf } from '../editor/blocks/shared';
import { projectDocument } from '../editor/projection/document';
import type { BlockRegistry } from '../editor/registry/build';

/** One checkable slice of the document, addressed the way the wire addresses it. */
export interface CheckableSegment {
  /** `"<blockSid>:<segmentIndex>"`. */
  readonly id: string;
  readonly sid: string;
  readonly segmentIndex: number;
  /** The text as sent: inline code and inline atoms blanked, length preserved. */
  readonly text: string;
  readonly hash: string;
  /** The absolute document position of a segment-local text offset. */
  positionAt(offset: number): number;
}

const CODE_MARK = 'codeMark';

/**
 * FNV-1a over the sent text, hex.
 *
 * The scheduler compares "is this the same text I already have an answer for",
 * not "are these two documents equal", so a short non-cryptographic digest is
 * the right size of answer. Collisions cost one wasted re-check.
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function segmentIdOf(sid: string, segmentIndex: number): string {
  return `${sid}:${String(segmentIndex)}`;
}

/** The block's projected text with everything unsendable blanked out. */
function maskedBlockText(node: PMNode, projectAtom: (node: PMNode) => string): string {
  const line = lineOf(node);
  if (!line) return '';
  let out = '';
  line.content.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      out += child.marks.some((mark) => mark.type.name === CODE_MARK) ? ' '.repeat(text.length) : text;
      return;
    }
    out += ' '.repeat(projectAtom(child).length);
  });
  return out;
}

/**
 * Cached by document identity, the way the projection under it is. A
 * ProseMirror document is immutable, so the same doc always segments to the
 * same answer, and the scheduler asks twice per batch, once to choose one and
 * once to place its answer, over a list that is O(document) to build.
 */
const segmentCache = new WeakMap<PMNode, CheckableSegment[]>();

/**
 * Every segment worth checking, in document order.
 *
 * Prose and image captions only. Source is not prose, and an equation's LaTeX
 * is not either; both have their own segment kind and are skipped by kind
 * rather than by block name, so a new block type that projects source is
 * covered the day it is added.
 *
 * An attribute-backed segment (a block equation stores its source outside the
 * document text) is skipped too, discriminated exactly as find discriminates
 * it: its text does not appear at its own offset in the joined projection.
 */
export function checkableSegments(doc: PMNode, registry: BlockRegistry): CheckableSegment[] {
  const cached = segmentCache.get(doc);
  if (cached) return cached;

  const projection = projectDocument(doc, registry);
  const projectAtom = atomProjector(registry.inlines);
  const blockByPos = new Map(projection.blocks.map((block) => [block.pos, block]));

  const out: CheckableSegment[] = [];
  const masked = new Map<number, string>();
  let currentBlockPos = -1;
  let segmentIndex = -1;

  for (const segment of projection.segments) {
    if (segment.blockPos === currentBlockPos) segmentIndex += 1;
    else {
      currentBlockPos = segment.blockPos;
      segmentIndex = 0;
    }

    if (segment.kind !== 'prose' && segment.kind !== 'imageAlt') continue;
    if (segment.sid.length === 0) continue;
    if (!projection.text.startsWith(segment.text, segment.docOffset)) continue;

    const block = blockByPos.get(segment.blockPos);
    if (!block) continue;

    let blockText = masked.get(segment.blockPos);
    if (blockText === undefined) {
      blockText = maskedBlockText(block.node, projectAtom);
      masked.set(segment.blockPos, blockText);
    }

    const text = blockText.slice(segment.offset, segment.offset + segment.text.length);
    if (text.trim().length === 0) continue;

    const blockPos = block.pos;
    const node = block.node;
    const project = block.module.project;
    const base = segment.offset;

    out.push({
      id: segmentIdOf(segment.sid, segmentIndex),
      sid: segment.sid,
      segmentIndex,
      text,
      hash: hashText(text),
      positionAt: (offset) => blockPos + project.positionOf(node, base + offset),
    });
  }

  segmentCache.set(doc, out);
  return out;
}

/**
 * The document positions a segment-local range covers, or null.
 *
 * Null whenever the round trip does not reproduce `text`, which is the same
 * guard find applies to a match: the projection folds an atom's source in as
 * characters while the atom occupies one position, so a range that touches one
 * maps to a span whose real document text is not the flagged text. Underlining
 * it would be wrong and replacing it would delete the atom.
 */
export function resolveRange(
  doc: PMNode,
  segment: CheckableSegment,
  start: number,
  end: number,
  text: string,
): { from: number; to: number } | null {
  if (end <= start) return null;
  const from = segment.positionAt(start);
  const to = segment.positionAt(end);
  if (from >= to) return null;
  if (doc.textBetween(from, to) !== text) return null;
  return { from, to };
}
