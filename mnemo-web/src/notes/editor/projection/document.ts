/**
 * Document-level canonical projections, composed from the per-block ones.
 *
 * Find, word count, the outline and the AI read surface all consume this. They
 * have to consume *the same* one: if two of them projected the document
 * independently, a text offset resolved against one would land in the wrong
 * place in the other, and the whole point of giving every block a `positionOf`
 * was to make that class of bug unrepresentable.
 *
 * Everything here is a pure function of the document. `walkBlocks` and
 * `projectDocument` each cache their own result by document identity: a
 * ProseMirror doc is immutable, so the same doc object always walks to the
 * same answer, and a caller that asks again before the next edit gets that
 * answer back instead of walking every block over again.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { BlockRegistry } from '../registry/build';
import type { AiSegment, AnyBlockModule } from '../registry/types';
import type { BlockType } from '../../model/types';

/**
 * One block, located.
 *
 * Carries its module so a caller that walks the document does not have to look
 * the same block up again to project it.
 */
export interface BlockEntry {
  readonly node: PMNode;
  /** Absolute position of the block node itself, as `getPos()` would report. */
  readonly pos: number;
  readonly sid: string;
  readonly id: string;
  readonly type: BlockType;
  /** 0 at the top level. */
  readonly depth: number;
  /** Index among its parent's *block* children; the line is not counted. */
  readonly index: number;
  readonly parentSid: string | null;
  readonly module: AnyBlockModule;
  readonly childCount: number;
}

/**
 * Cached by document identity: a ProseMirror doc is immutable, so the same
 * doc object always walks to the same blocks. The outline chip rebuilds its
 * list against the doc on every scroll event, and between edits that is the
 * same doc object each time.
 */
const blockWalkCache = new WeakMap<PMNode, BlockEntry[]>();

/**
 * Every block in the document, in document order, parents before children.
 *
 * Document order is what makes this usable as an index: a caller can stop at
 * the first match, and the outline can render straight from it.
 */
export function walkBlocks(doc: PMNode, registry: BlockRegistry): BlockEntry[] {
  const cached = blockWalkCache.get(doc);
  if (cached) return cached;

  const out: BlockEntry[] = [];

  const visit = (parent: PMNode, parentPos: number, parentSid: string | null, depth: number) => {
    // A node's content begins one position after the node itself. The document
    // has no opening token, so it starts its children at 0, hence the -1 seed.
    let offset = parentPos + 1;
    let index = 0;

    parent.forEach((child) => {
      const pos = offset;
      offset += child.nodeSize;

      // Skips the mandatory line, and anything else that is not a block: only
      // block nodes have modules, so this is the membership test rather than a
      // name check that would need updating per block type.
      const module = registry.byNodeName.get(child.type.name);
      if (!module) return;

      const sid = String(child.attrs.sid ?? '');
      out.push({
        node: child,
        pos,
        sid,
        id: String(child.attrs.id ?? ''),
        type: module.wireTypeOf(child),
        depth,
        index,
        parentSid,
        module,
        childCount: countBlockChildren(child, registry),
      });
      index += 1;

      visit(child, pos, sid, depth + 1);
    });
  };

  visit(doc, -1, null, 0);
  blockWalkCache.set(doc, out);
  return out;
}

function countBlockChildren(node: PMNode, registry: BlockRegistry): number {
  let n = 0;
  node.forEach((child) => {
    if (registry.byNodeName.has(child.type.name)) n += 1;
  });
  return n;
}

/** A block's `AiSegment`, placed in the document rather than in its block. */
export interface DocumentSegment extends AiSegment {
  readonly sid: string;
  /** Absolute position of the owning block node. */
  readonly blockPos: number;
  /** Where this segment starts in `documentText`. */
  readonly docOffset: number;
}

export interface DocumentProjection {
  /** Every block's own text, in document order, one block per line. */
  readonly text: string;
  readonly segments: readonly DocumentSegment[];
  readonly blocks: readonly BlockEntry[];
}

/**
 * Cached by document identity, for the same reason `walkBlocks` is: a
 * ProseMirror doc is immutable, so re-projecting the same doc object between
 * edits would only recompute what the first call already answered.
 */
const documentProjectionCache = new WeakMap<PMNode, DocumentProjection>();

/**
 * Projects the whole document in a single pass.
 *
 * One pass rather than three functions a caller composes, because `text` and
 * `segments` have to agree on offsets exactly. Computing them separately would
 * make that agreement a convention two functions must independently maintain
 * instead of a property of how they are built.
 */
export function projectDocument(doc: PMNode, registry: BlockRegistry): DocumentProjection {
  const cached = documentProjectionCache.get(doc);
  if (cached) return cached;

  const blocks = walkBlocks(doc, registry);
  const segments: DocumentSegment[] = [];
  const parts: string[] = [];
  let docOffset = 0;

  for (const block of blocks) {
    const text = block.module.project.plainText(block.node);
    for (const segment of block.module.project.aiSegments(block.node)) {
      segments.push({
        ...segment,
        sid: block.sid,
        blockPos: block.pos,
        docOffset: docOffset + segment.offset,
      });
    }
    parts.push(text);
    // Every block contributes a separator, including the last, so a block's
    // document offset never depends on whether a later block exists. An
    // append would otherwise shift nothing but still change the string's tail.
    docOffset += text.length + 1;
  }

  const projection: DocumentProjection = {
    text: parts.length > 0 ? `${parts.join('\n')}\n` : '',
    segments,
    blocks,
  };
  documentProjectionCache.set(doc, projection);
  return projection;
}

/**
 * Converts an offset in `documentText` to an absolute ProseMirror position.
 *
 * Not addition: an inline atom projects as its whole LaTeX source but occupies
 * exactly one position, so the two coordinate spaces drift apart inside any
 * block that contains one.
 */
export function documentPositionOf(projection: DocumentProjection, offset: number): number | null {
  let docOffset = 0;
  for (const block of projection.blocks) {
    const text = block.module.project.plainText(block.node);
    // `<=` so an offset at the very end of a block resolves to that block
    // rather than falling through to the next one's start.
    if (offset <= docOffset + text.length) {
      return block.pos + block.module.project.positionOf(block.node, offset - docOffset);
    }
    docOffset += text.length + 1;
  }
  return null;
}
