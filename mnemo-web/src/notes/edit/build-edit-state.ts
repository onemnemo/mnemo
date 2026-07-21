/**
 * Turns a note's stored blocks into an *editable* `EditorState`, or a quarantine
 * reason — the sibling of `read/build-state.ts`, differing only in the plugin
 * stack it wires.
 *
 * The load-and-quarantine decision is identical to the read path and stays that
 * way on purpose: whether a note can become a document is a property of its
 * bytes, not of whether the caret is allowed in. So the same mapper runs, the
 * same quarantine reason comes back, and only when the blocks are representable
 * does this add the editing behaviour on top.
 *
 * What the read state omits and this adds is every plugin that reacts to a change
 * the user makes: the structural key commands, the formatting keymap, the
 * markdown input shortcuts, the invariant pipeline that repairs the document
 * after each edit, and — shared with the read path — the decoration that numbers
 * ordered lists. The order is load-bearing where two plugins bind one key, and is
 * documented on `editorPlugins`.
 */

import { EditorState, type Plugin } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { editorSchema } from '../editor/schema';
import { createDocumentMapper, type QuarantineReason } from '../editor/mapper/document';
import { invariantPipeline } from '../editor/pipeline/invariants';
import { inputTriggerPlugin } from '../editor/pipeline/input-triggers';
import { numberedListPlugin } from '../editor/pipeline/list-numbers';
import { structureKeymap } from '../editor/commands/structure';
import { editorKeymap } from '../editor/commands';
import type { BlockRegistry } from '../editor/registry/build';
import type { Block } from '../model/types';

export type NoteEditState =
  | { readonly ok: true; readonly state: EditorState; readonly registry: BlockRegistry }
  | { readonly ok: false; readonly reason: QuarantineReason };

/**
 * The editable plugin stack, in precedence order.
 *
 * ProseMirror gives an earlier plugin first refusal on a key, so the ordering is
 * a real decision, not a list:
 *
 *  - `inputTriggerPlugin` runs on text input, not on a key chord, so it sits
 *    first without competing with the keymaps.
 *  - `structureKeymap` must precede `baseKeymap`: both bind Enter and Backspace,
 *    and ours has to win so a split lands our block shapes. It declines
 *    (returns false) for the cases it does not own — a mid-line Backspace, a
 *    cross-block selection — and those fall through to the base behaviour.
 *  - `editorKeymap` carries the formatting chords, which collide with nothing
 *    structural; its place before `baseKeymap` is for tidiness, not correctness.
 *  - `baseKeymap` is the ProseMirror default of last resort.
 *  - `invariantPipeline` reacts after the fact through `appendTransaction`, and
 *    `numberedListPlugin` only decorates; neither touches key dispatch.
 */
export function editorPlugins(registry: BlockRegistry): Plugin[] {
  return [
    inputTriggerPlugin(registry),
    structureKeymap(),
    editorKeymap(),
    keymap(baseKeymap),
    invariantPipeline(registry),
    numberedListPlugin(),
  ];
}

/**
 * Build the editable `EditorState` for a note's blocks.
 *
 * An empty block list seeds a single empty block rather than failing — a new note
 * is editable, not quarantined. Quarantine is reserved, exactly as on the read
 * path, for content the schema cannot represent, so an unreadable note is never
 * degraded into a blank editable document the autosave would then write over its
 * real bytes.
 */
export function buildNoteEditState(blocks: readonly Block[]): NoteEditState {
  const { schema, registry } = editorSchema();
  const mapper = createDocumentMapper(schema, registry);
  const result = mapper.toDoc(blocks);
  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    state: EditorState.create({ schema, doc: result.doc, plugins: editorPlugins(registry) }),
    registry,
  };
}
