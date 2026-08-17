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
import { columnSplitterPlugin } from '../editor/pipeline/column-splitter';
import { containerCaretGuard } from '../editor/pipeline/container-caret';
import { imageClipboardPlugin } from '../editor/pipeline/image-clipboard';
import { clipboardPlugin } from '../clipboard/clipboard-plugin';
import { defaultPasteAssetSupport } from '../clipboard/stage-assets';
import { nestedInputGuard } from '../editor/pipeline/nested-input';
import { numberedListPlugin } from '../editor/pipeline/list-numbers';
import { codeHighlightPlugin } from '../editor/code/highlight';
import { slashHintPlugin } from '../editor/pipeline/slash-hint';
import { findPlugin } from '../find/find-plugin';
import { blockSelectionPlugin } from '../selection/block-selection-plugin';
import { resolveServices } from '../editor/view/nodeviews';
import type { EditorServices } from '../editor/registry/types';
import { structureKeymap } from '../editor/commands/structure';
import { editorKeymap } from '../editor/commands';
import { editorHistory, historyBoundaryPlugin } from '../editor/history';
import { formattingToolbarPlugin } from '../editor/toolbar/formatting-toolbar';
import { slashMenuPlugin } from '../editor/slash';
import type { BlockRegistry } from '../editor/registry/build';
import type { InlineMapper } from '../editor/mapper/inline';
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
 *  - `slashMenuPlugin` takes the arrow keys and Enter while its menu is open,
 *    so it has to precede every keymap. It declines every key when the menu is
 *    closed, which is almost always.
 *  - `blockSelectionPlugin` claims Backspace/Delete and Escape only while a
 *    block selection is live, and Ctrl+A for select-all; it must precede the
 *    structural keymap so those win over the per-character handlers, and it
 *    declines everything else, so it is invisible until a selection exists.
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
 *    `numberedListPlugin`, `findPlugin` and `intrinsicSizePlugin` only decorate;
 *    none of them touch key dispatch except `findPlugin`, which claims Ctrl+F
 *    (unclaimed by anything above) and Escape only while find is open.
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
 *  - `formattingToolbarPlugin` binds one key, the chord that moves focus into
 *    the toolbar, and nothing else here or in `baseKeymap` claims it. It has no
 *    `appendTransaction` either, so it takes no part in the precedence this
 *    ordering describes and is listed last.
 */
export function editorPlugins(
  registry: BlockRegistry,
  inline: InlineMapper,
  services?: Partial<EditorServices>,
): Plugin[] {
  return [
    nestedInputGuard(),
    // Before anything that could read a paste as text input; it claims only pastes and
    // drops carrying image files and declines everything else.
    imageClipboardPlugin(resolveServices(services)),
    // Directly after the image plugin so an image-file paste is still claimed
    // first: it owns copy, cut and paste, reads the document rather than the DOM,
    // and dispatches no step on copy, so it never dirties the note. It restages
    // pasted images through the same services the node views resolve assets with.
    clipboardPlugin(registry, inline, defaultPasteAssetSupport(resolveServices(services))),
    // Given the same services the node views get: the page row creates the note
    // its card will point at before it writes anything into the document.
    slashMenuPlugin(registry, { services: resolveServices(services) }),
    // Before the structural keymap so that, while a block selection is live, it
    // claims Backspace/Delete (delete the selection) and Escape (clear it)
    // before the per-character handlers see them, and claims Ctrl+A to select
    // every block. It declines every key when nothing is selected and the chord
    // is not select-all, so the editor behaves exactly as before until a block
    // selection exists. Its highlight is a decoration and it appends no step, so
    // it never dirties the note.
    blockSelectionPlugin(registry),
    inputTriggerPlugin(registry),
    structureKeymap(),
    editorKeymap(),
    keymap(baseKeymap),
    invariantPipeline(registry),
    // After the invariants: it reads the selection the repairs settled on, and
    // like them it appends rather than touching key dispatch.
    containerCaretGuard(),
    numberedListPlugin(),
    // Another decoration-only neighbour: it colours source and nothing else, so
    // it claims no key, appends no step and never dirties the note.
    codeHighlightPlugin(),
    // Decoration only, like its neighbours: a placeholder on the focused empty
    // paragraph. It appends no step and claims no key, so it never dirties the
    // note or competes for input.
    slashHintPlugin(),
    // A decoration plugin like the two around it: it paints match highlights and
    // claims Ctrl+F (so the browser's own find never opens). View-only, appending
    // no document step, so it never dirties the note or moves its version. Its
    // handleKeyDown claims only Ctrl+F, and Escape while find is open, neither of
    // which any earlier plugin takes.
    findPlugin(),
    intrinsicSizePlugin(registry),
    columnSplitterPlugin(),
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
export function buildNoteEditState(
  blocks: readonly Block[],
  services?: Partial<EditorServices>,
): NoteEditState {
  const { schema, registry, inline } = editorSchema();
  const mapper = createDocumentMapper(schema, registry);
  const result = mapper.toDoc(blocks);
  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    state: EditorState.create({ schema, doc: result.doc, plugins: editorPlugins(registry, inline, services) }),
    registry,
    mapper,
  };
}
