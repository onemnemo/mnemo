/**
 * `Block[]` <-> ProseMirror document.
 *
 * The mapper itself is small, because it holds no per-type knowledge at all —
 * every block type's conversion lives in its own module and this only
 * dispatches. That is the point of the registry: adding the eighteenth block
 * type must not require editing the mapper.
 *
 * **Failure is a value, never an exception that reaches the user.** A note whose
 * content this cannot represent goes to quarantine holding its original blocks,
 * so it can be exported and repaired. It is never degraded into an empty
 * editable note — that looks to the user exactly like their work being deleted,
 * and the autosave that follows would make it true.
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import type { BlockRegistry } from '../registry/build';
import type { BlockSchema, SerializeContext } from '../registry/types';
import type { Block } from '../../model/types';
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
}

export function createDocumentMapper(
  schema: Schema,
  registry: BlockRegistry,
): DocumentMapper {
  const blockSchema = schema as unknown as BlockSchema;

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
      const { blocks: normalized, issues } = normalizeBlocks(blocks);
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
      doc.forEach((child) => blocks.push(ctx.fromChild(child)));
      return blocks;
    },
  };
}

/** Distinguishes an unmapped wire type from a schema rejection, for the reason code. */
class UnknownTypeError extends Error {
  constructor(block: Block) {
    super(`no block module owns wire type "${block.type}" (block ${block.id})`);
    this.name = 'UnknownTypeError';
  }
}
