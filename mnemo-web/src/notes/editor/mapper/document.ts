/**
 * `Block[]` <-> ProseMirror document.
 *
 * The mapper itself is small, because it holds no per-type knowledge at all,
 * every block type's conversion lives in its own module and this only
 * dispatches. That is the point of the registry: adding the eighteenth block
 * type must not require editing the mapper.
 *
 * **Failure is a value, never an exception that reaches the user.** A note whose
 * content this cannot represent goes to quarantine holding its original blocks,
 * so it can be exported and repaired. It is never degraded into an empty
 * editable note, that looks to the user exactly like their work being deleted,
 * and the autosave that follows would make it true.
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import type { BlockRegistry } from '../registry/build';
import type { BlockSchema, SerializeContext } from '../registry/types';
import type { Block } from '../../model/types';
import { seedBlock as defaultSeedBlock } from '../../model/factory';
import { normalizeBlocks, type NormalizeIssue } from './normalize';

export interface QuarantineReason {
  readonly kind: 'invalid-shape' | 'unknown-type' | 'schema-rejected';
  readonly message: string;
  readonly issues: readonly NormalizeIssue[];
}

export type ToDocResult =
  | { readonly ok: true; readonly doc: PMNode }
  | { readonly ok: false; readonly reason: QuarantineReason; readonly blocks: readonly Block[] };

export interface DocumentMapper {
  toDoc(blocks: readonly Block[]): ToDocResult;
  fromDoc(doc: PMNode): Block[];
  /**
   * One block, converted through its owning module.
   *
   * The op compiler needs this: `add` builds a node from a freshly minted block
   * and `type` rebuilds one through the model layer so a converted block cannot
   * end up carrying a payload its new type has nowhere to put. Throws for an
   * unmapped wire type, which is unreachable for a block the compiler itself
   * created.
   */
  toNode(block: Block): PMNode;
  fromNode(node: PMNode): Block;
}

export interface MapperDeps {
  /**
   * Supplies the block an empty note opens with.
   *
   * Injected rather than imported so the mapper stays a pure function of what
   * it is built with: the default mints a real GUID and sid, which is exactly
   * what a test wanting reproducible output does not want.
   */
  seedBlock(): Block;
}

export function createDocumentMapper(
  schema: Schema,
  registry: BlockRegistry,
  deps: MapperDeps = { seedBlock: defaultSeedBlock },
): DocumentMapper {
  const blockSchema = schema as unknown as BlockSchema;

  // `fromDoc` runs on every autosave, and a PM node is immutable: an edit
  // anywhere replaces only the top-level nodes on its path, so every sibling
  // outside that path is the exact same object it was last time. Caching by
  // that identity turns "reserialize the whole note" into "reserialize what
  // actually changed", with no correctness risk, two different Block
  // outputs can never share a node reference, because a node can only
  // change by becoming a different object.
  const fromChildCache = new WeakMap<PMNode, Block>();
  /** The same block with its document position written in, keyed the same way. */
  const positionedCache = new WeakMap<PMNode, { index: number; block: Block }>();

  /**
   * The dispatcher every container converts its children through.
   *
   * Without it a recursive container is not expressible: a column group's
   * `fromNode` has to return a complete `Block` including children, those
   * children belong to other modules, and PM nodes are immutable so there is no
   * shell for an outer pass to fill in later.
   */
  const ctx: SerializeContext = {
    toChild(block) {
      const module = registry.byWireType.get(block.type);
      if (!module) throw new UnknownTypeError(block);
      return module.serialize.toNode(block, blockSchema, ctx);
    },
    fromChild(node) {
      const module = registry.byNodeName.get(node.type.name);
      // Unreachable for any node built from this schema; a node type with no
      // module could only come from a second schema, which the editor never has.
      if (!module) throw new Error(`no block module owns node type "${node.type.name}"`);
      return module.serialize.fromNode(node, ctx);
    },
  };

  return {
    toDoc(blocks) {
      // A note with no blocks is an ordinary state, not corruption: `Note.Blocks`
      // is nullable and a newly created note leaves it null. The schema requires
      // `block+`, so seeding here is what keeps a brand-new note from opening as
      // a quarantined document, which would look to the user exactly like their
      // note failing to load.
      const source = blocks.length > 0 ? blocks : [deps.seedBlock()];
      const { blocks: normalized, issues } = normalizeBlocks(source);
      if (issues.length > 0) {
        return {
          ok: false,
          blocks,
          reason: {
            kind: 'invalid-shape',
            message: issues.map((i) => `${i.blockId}: ${i.detail}`).join('; '),
            issues,
          },
        };
      }

      try {
        const doc = schema.nodes.doc.create(null, normalized.map((block) => ctx.toChild(block)));
        // `check` is what turns "PM accepted the pieces" into "PM accepts the
        // document": content expressions are only enforced on the whole node,
        // so a container assembled from valid children can still be invalid.
        doc.check();
        return { ok: true, doc };
      } catch (error) {
        const unknown = error instanceof UnknownTypeError;
        return {
          ok: false,
          blocks,
          reason: {
            kind: unknown ? 'unknown-type' : 'schema-rejected',
            message: error instanceof Error ? error.message : String(error),
            issues: [],
          },
        };
      }
    },

    fromDoc(doc) {
      const blocks: Block[] = [];
      doc.forEach((child, _offset, index) => {
        let block = fromChildCache.get(child);
        if (!block) {
          block = ctx.fromChild(child);
          fromChildCache.set(child, block);
        }
        // Positioned per node and index, so a save with nothing moved hands back
        // the very same objects as the last one, which is what the cache is for.
        const positioned = positionedCache.get(child);
        if (positioned && positioned.index === index) {
          blocks.push(positioned.block);
          return;
        }
        const placed = withDocumentOrder([block], index)[0];
        positionedCache.set(child, { index, block: placed });
        blocks.push(placed);
      });
      return blocks;
    },

    toNode: (block) => ctx.toChild(block),
    fromNode: (node) => ctx.fromChild(node),
  };
}

/**
 * The blocks with `order` set to their position, at every level.
 *
 * The editor never reads `order`; document position is its order. Every reader
 * on the other side of the wire sorts by the field, though: the PDF and
 * markdown exports, the plain text projection, and the note tools, which commit
 * the sorted list back. A block the editor creates carries the schema default
 * and the rest keep whatever they were loaded with, so without this a note
 * edited here exports with its new blocks sorted to the front. Position is the
 * one truth both sides can agree on, and writing it on every save also heals a
 * note whose stored sequence had already drifted. Shallow copies, so the cached
 * blocks above stay the pure function of their node that the cache relies on.
 */
function withDocumentOrder(blocks: readonly Block[], first = 0): Block[] {
  return blocks.map((block, offset) => {
    const index = first + offset;
    const children = block.children ? withDocumentOrder(block.children) : block.children;
    return block.order === index && children === block.children ? block : { ...block, order: index, children };
  });
}

/** Distinguishes an unmapped wire type from a schema rejection, for the reason code. */
class UnknownTypeError extends Error {
  constructor(block: Block) {
    super(`no block module owns wire type "${block.type}" (block ${block.id})`);
    this.name = 'UnknownTypeError';
  }
}
