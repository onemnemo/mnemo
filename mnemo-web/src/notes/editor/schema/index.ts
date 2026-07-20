/**
 * Builds the one ProseMirror schema, from the registry.
 *
 * This is the seam the registry deliberately leaves open: the registry produces node and
 * mark specs but does not construct a `Schema`, because the base nodes belong
 * here and a registry that owned them would have to know what a document is.
 *
 * Everything is assembled once and handed out as a unit. Nothing in the editor
 * constructs a second schema — PM node types are compared by identity, so two
 * schemas in one document produce errors that read like corruption.
 */

import { Schema } from 'prosemirror-model';
import { buildBlockRegistry, type BlockRegistry } from '../registry/build';
import type { BlockSchema } from '../registry/types';
import { createInlineMapper, type InlineMapper } from '../mapper/inline';
import { createBlockModules } from '../blocks';
import { atomProjector } from '../blocks/shared';
import { baseNodes } from './base';
import { markModules } from './marks';
import { inlineModules } from './inlines';

export interface EditorSchema {
  readonly schema: Schema;
  readonly registry: BlockRegistry;
  readonly inline: InlineMapper;
}

let cached: EditorSchema | null = null;

/**
 * The schema is a pure function of the module list, so it is built once and
 * shared. `createEditorSchema` exists for tests that need an isolated one.
 */
export function editorSchema(): EditorSchema {
  cached ??= createEditorSchema();
  return cached;
}

export function createEditorSchema(): EditorSchema {
  const inline = createInlineMapper(markModules, inlineModules);
  const deps = { inline, projectAtom: atomProjector(inlineModules) };
  const blocks = createBlockModules(deps);

  const registry = buildBlockRegistry(
    { blocks, marks: markModules, inlines: inlineModules },
    { baseNodes },
  );

  const schema = new Schema({
    nodes: registry.nodeSpecs,
    marks: registry.markSpecs,
  });

  return { schema, registry, inline };
}

/** The structural view of a `Schema` that module serializers are written against. */
export function asBlockSchema(schema: Schema): BlockSchema {
  return schema as unknown as BlockSchema;
}

export { baseNodes, baseNodeNames } from './base';
export { markModules } from './marks';
export { inlineModules } from './inlines';
