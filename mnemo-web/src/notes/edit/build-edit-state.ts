/**
 * Turns a note's stored blocks into an *editable* `EditorState`, or a quarantine
 * reason, the sibling of `read/build-state.ts`, differing only in the plugin
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
 * after each edit, the undo history and its grouping, plus the two decorations
 * shared with the read path: the ordered-list numbers and the reserved block
 * heights that let the engine skip what is off screen. The order is load-bearing
 * where two plugins bind one key or append after another, and is documented on
 * `editorPlugins`.
 */

import { EditorState, type Plugin } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { editorSchema } from '../editor/schema';
import {
  createDocumentMapper,
  type DocumentMapper,
  type QuarantineReason,
} from '../editor/mapper/document';
import { blockIdentityPlugin } from '../editor/pipeline/block-identity';
import { invariantPipeline } from '../editor/pipeline/invariants';
import { inputTriggerPlugin } from '../editor/pipeline/input-triggers';
import { intrinsicSizePlugin } from '../editor/pipeline/intrinsic-size';
import { nestedInputGuard } from '../editor/pipeline/nested-input';
import { numberedListPlugin } from '../editor/pipeline/list-numbers';
import { structureKeymap } from '../editor/commands/structure';
import { editorKeymap } from '../editor/commands';
import { editorHistory, historyBoundaryPlugin } from '../editor/history';
import { formattingToolbarPlugin } from '../editor/toolbar/formatting-toolbar';
import type { BlockRegistry } from '../editor/registry/build';
import type { Block } from '../model/types';

export type NoteEditState =
  | {
      readonly ok: true;
      readonly state: EditorState;
      readonly registry: BlockRegistry;
      /**
       * The same mapper the state was built with, for the way back out.
       *
       * Saving has to serialize through it, and a second mapper built from a
       * second `editorSchema()` would compare node types by identity against a
       * schema this document was never made from.
       */
      readonly mapper: DocumentMapper;
    }
  | { readonly ok: false; readonly reason: QuarantineReason };

/**
 * The editable plugin stack, in precedence order.
 *
 * ProseMirror gives an earlier plugin first refusal on a key, so the ordering is
 * a real decision, not a list:
 *
 *  - `nestedInputGuard` is first because its whole job is to answer before the
 *    others: an event from a text input inside the editor belongs to that input,
 *    and every plugin below would otherwise treat it as a document edit.
 *  - `inputTriggerPlugin` runs on text input, not on a key chord, so it sits
 *    before the keymaps without competing with them.
 *  - `structureKeymap` must precede `baseKeymap`: both bind Enter and Backspace,
 *    and ours has to win so a split lands our block shapes. It declines
 *    (returns false) for the cases it does not own, a mid-line Backspace, a
 *    cross-block selection, and those fall through to the base behaviour.
 *  - `editorKeymap` carries the formatting chords, which collide with nothing
 *    structural; its place before `baseKeymap` is for tidiness, not correctness.
 *  - `baseKeymap` is the ProseMirror default of last resort.
 *  - `invariantPipeline` reacts after the fact through `appendTransaction`, and
 *    `numberedListPlugin` and `intrinsicSizePlugin` only decorate; none of them
 *    touch key dispatch.
 *  - `blockIdentityPlugin` also only appends. Its place after the pipeline is
 *    not load-bearing, a block the pipeline itself creates gets its identity on
 *    the next append round either way, but reading it last matches when it
 *    acts, which is once everything else has settled on a shape.
 *  - `historyBoundaryPlugin` comes last among the plugins this ordering
 *    actually governs, and that placement *is* load-bearing. It closes the
 *    undo group after a discrete edit, and everything a repair plugin
 *    appends has to be inside that edit rather than after it. Closing first
 *    would leave the repair to open a group of its own, so undoing a split
 *    would take two presses, one for the repair, one for the split.
 *  - `formattingToolbarPlugin` has neither a keymap nor an
 *    `appendTransaction`, only a `view()` that reads the selection back,
 *    it takes no part in the precedence this ordering describes, so its
 *    place in the array is arbitrary and it is listed last.
 */
export function editorPlugins(registry: BlockRegistry): Plugin[] {
  return [
    nestedInputGuard(),
    inputTriggerPlugin(registry),
    structureKeymap(),
    editorKeymap(),
    keymap(baseKeymap),
    invariantPipeline(registry),
    numberedListPlugin(),
    intrinsicSizePlugin(registry),
    blockIdentityPlugin(registry),
    editorHistory(),
    historyBoundaryPlugin(),
    formattingToolbarPlugin(),
  ];
}

/**
 * Build the editable `EditorState` for a note's blocks.
 *
 * An empty block list seeds a single empty block rather than failing, a new note
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
    mapper,
  };
}
