/**
 * Turns a note's stored blocks into an `EditorState` ready to mount, or a
 * quarantine reason.
 *
 * This is the load-and-quarantine path this layer owns and the mount deliberately stays
 * out of. It is a pure function of the blocks: no fetching, no React, no view,
 * so the whole "does this note become a state or a quarantine" question is
 * decided and tested without rendering anything. The route component fetches the
 * blocks and renders the outcome.
 *
 * The schema and registry come from the shared cached `editorSchema()`, the same
 * instance the mount reads its NodeViews from — PM compares node types by
 * identity, so building the doc against one schema and mounting it under another
 * would read as corruption.
 */

import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../editor/schema';
import { createDocumentMapper, type QuarantineReason } from '../editor/mapper/document';
import { numberedListPlugin } from '../editor/pipeline/list-numbers';
import type { BlockRegistry } from '../editor/registry/build';
import type { Block } from '../model/types';

export type NoteReadState =
  | { readonly ok: true; readonly state: EditorState; readonly registry: BlockRegistry }
  | { readonly ok: false; readonly reason: QuarantineReason };

/**
 * Build the read-only `EditorState` for a note's blocks.
 *
 * An empty block list is not a failure — the mapper seeds a single empty block,
 * so a brand-new or bodyless note becomes a valid (empty) state rather than a
 * quarantine. Quarantine is reserved for content the schema genuinely cannot
 * represent, and it carries its reason so the route can say *why* rather than
 * degrading the note into an empty editable document it would then autosave over.
 */
export function buildNoteReadState(blocks: readonly Block[]): NoteReadState {
  const { schema, registry } = editorSchema();
  const mapper = createDocumentMapper(schema, registry);
  const result = mapper.toDoc(blocks);
  if (!result.ok) return { ok: false, reason: result.reason };
  // Even read-only, the numbered-list numbers are computed by a decoration
  // plugin, not stored — so a rendered note needs it to show a sequence at all.
  return {
    ok: true,
    state: EditorState.create({ schema, doc: result.doc, plugins: [numberedListPlugin()] }),
    registry,
  };
}
