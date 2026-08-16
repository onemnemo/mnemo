/**
 * The block-selection plugin: the selected-block set and its highlight, all
 * view-only.
 *
 * Like the find plugin, nothing here touches the document. The set lives in
 * plugin state and the highlight is a `DecorationSet`; every transaction this
 * plugin dispatches carries only a meta, never a step. The authority bumps the
 * revision and marks the note dirty strictly on `tr.docChanged`, so selecting,
 * extending, and clearing never dirty the note, move `Ver`, or wake autosave.
 *
 * The set is dropped the moment the document changes or the caret moves: an edit
 * or a click into text ends a block selection, which is what the desktop does
 * (any content change or focus clears it) and what keeps the set honest without
 * mapping it across edits. A scroll dispatches no transaction, so the set - and
 * its decorations, positioned by the unchanged document - survives scrolling
 * untouched, which is the one persistence the selection has to guarantee.
 *
 * Turning the sid set into decorations is O(document), so it is not done per
 * keystroke: it only runs when the set is deliberately changed. To keep even a
 * marquee drag cheap - many set changes over one unchanging document - the
 * sid->position map is cached by document identity, so each set after the first
 * on a given document costs only the size of the set.
 */

import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import type { BlockRegistry } from '../editor/registry/build';
import {
  EMPTY_SELECTION,
  orderedSids,
  selectAll,
  selectableEntries,
  type BlockSelection,
} from './block-selection';
import { buildDeleteSelected } from './delete-selected';

export interface BlockSelectionPluginState extends BlockSelection {
  readonly decorations: DecorationSet;
}

type BlockSelectionMeta =
  | { readonly type: 'set'; readonly selection: BlockSelection }
  | { readonly type: 'clear' };

export const blockSelectionKey = new PluginKey<BlockSelectionPluginState>('notes-block-selection');

const EMPTY: BlockSelectionPluginState = {
  ...EMPTY_SELECTION,
  decorations: DecorationSet.empty,
};

export function getBlockSelection(state: EditorState): BlockSelectionPluginState {
  return blockSelectionKey.getState(state) ?? EMPTY;
}

/**
 * Replace the selection with `selection` on a bare, non-document transaction.
 *
 * A live text range is collapsed at the same time, so a block selection and a
 * text selection are never both active - the desktop drops the text selection
 * when it marks blocks, and without this a Backspace would act on the block set
 * while the toolbar still pointed at a range. The collapse rides the same
 * transaction; because `apply` honors the `set` meta before its clear-on-
 * selection-change branch, collapsing here does not wipe the set being made.
 */
export function setBlockSelection(view: EditorView, selection: BlockSelection): void {
  const tr = view.state.tr.setMeta(blockSelectionKey, { type: 'set', selection } satisfies BlockSelectionMeta);
  if (!view.state.selection.empty) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(view.state.selection.from)));
  }
  view.dispatch(tr);
}

/** Drop the whole selection. */
export function clearBlockSelection(view: EditorView): void {
  if (getBlockSelection(view.state).selected.size === 0) return;
  view.dispatch(view.state.tr.setMeta(blockSelectionKey, { type: 'clear' } satisfies BlockSelectionMeta));
}

/**
 * A sid -> {pos, size} map for one document, cached by document identity.
 *
 * A ProseMirror document is immutable, so the map is valid for the life of that
 * document object and is thrown away with it (a WeakMap holds no document alive).
 * The first decoration build on a document pays the O(document) walk; every set
 * after it on the same document reuses the map.
 */
const positionCache = new WeakMap<PMNode, Map<string, { pos: number; size: number }>>();

function positionsOf(doc: PMNode, registry: BlockRegistry): Map<string, { pos: number; size: number }> {
  const cached = positionCache.get(doc);
  if (cached) return cached;
  const map = new Map<string, { pos: number; size: number }>();
  for (const entry of selectableEntries(doc, registry)) {
    map.set(entry.sid, { pos: entry.pos, size: entry.node.nodeSize });
  }
  positionCache.set(doc, map);
  return map;
}

function decorationsFor(doc: PMNode, registry: BlockRegistry, selected: ReadonlySet<string>): DecorationSet {
  if (selected.size === 0) return DecorationSet.empty;
  const positions = positionsOf(doc, registry);
  const decos: Decoration[] = [];
  for (const sid of selected) {
    const at = positions.get(sid);
    // A sid that is no longer in the document (deleted by some other path) is
    // simply not drawn; the set is reconciled to what survives on the next set.
    if (at) decos.push(Decoration.node(at.pos, at.pos + at.size, { class: 'notes-block-selected' }));
  }
  return DecorationSet.create(doc, decos);
}

const listeners = new WeakMap<EditorView, Set<(state: BlockSelectionPluginState) => void>>();

export function subscribeBlockSelection(
  view: EditorView,
  listener: (state: BlockSelectionPluginState) => void,
): () => void {
  const set = listeners.get(view) ?? new Set();
  set.add(listener);
  listeners.set(view, set);
  return () => {
    set.delete(listener);
  };
}

function notify(view: EditorView, state: BlockSelectionPluginState): void {
  const set = listeners.get(view);
  if (!set) return;
  for (const listener of set) listener(state);
}

function isSelectAll(event: KeyboardEvent): boolean {
  if (event.key !== 'a' && event.key !== 'A') return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  return !event.shiftKey && !event.altKey;
}

/**
 * Whether the caret sits in a block whose own text should keep Ctrl+A - a code
 * block's source or an image's caption. There the block selection declines and
 * the default select-all runs (which selects the whole document's text, the
 * same as before this plugin existed), rather than selecting every block out
 * from under someone editing code or a caption.
 */
function inVerbatimContext(state: EditorState): boolean {
  const $head = state.selection.$head;
  for (let depth = $head.depth; depth > 0; depth--) {
    const name = $head.node(depth).type.name;
    if (name === 'codeBlock' || name === 'image') return true;
  }
  return false;
}

export function blockSelectionPlugin(registry: BlockRegistry): Plugin<BlockSelectionPluginState> {
  return new Plugin<BlockSelectionPluginState>({
    key: blockSelectionKey,
    state: {
      init: () => EMPTY,
      apply(tr, old, _oldState, newState): BlockSelectionPluginState {
        const meta = tr.getMeta(blockSelectionKey) as BlockSelectionMeta | undefined;

        if (meta?.type === 'set') {
          return {
            ...meta.selection,
            decorations: decorationsFor(newState.doc, registry, meta.selection.selected),
          };
        }
        if (meta?.type === 'clear') {
          return EMPTY;
        }

        if (old.selected.size === 0) return old;
        // An edit or a deliberate caret/text-selection change ends the block
        // selection. A view-only transaction that does neither (a find highlight,
        // for instance) leaves it, and its decorations are still valid because
        // the document did not move.
        if (tr.docChanged || tr.selectionSet) return EMPTY;
        return old;
      },
    },
    props: {
      decorations(this: Plugin<BlockSelectionPluginState>, state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty;
      },
      handleKeyDown(view, event) {
        const selection = getBlockSelection(view.state);

        if (selection.selected.size > 0) {
          if (event.key === 'Escape') {
            clearBlockSelection(view);
            return true;
          }
          if (event.key === 'Backspace' || event.key === 'Delete') {
            const tr = buildDeleteSelected(view.state, registry, selection.selected);
            if (tr) {
              view.dispatch(tr);
              view.focus();
            }
            return true;
          }
        }

        if (isSelectAll(event) && !inVerbatimContext(view.state)) {
          const order = orderedSids(view.state.doc, registry);
          if (order.length > 0) {
            // The editor already holds focus (this handler only runs for its own
            // keydown), so the following Delete or Escape reaches this plugin.
            setBlockSelection(view, selectAll(order));
            return true;
          }
        }

        return false;
      },
    },
    view(editorView) {
      return {
        update(view, prevState) {
          const next = getBlockSelection(view.state);
          const prev = getBlockSelection(prevState);
          if (next !== prev) notify(view, next);
        },
        destroy() {
          listeners.delete(editorView);
        },
      };
    },
  });
}
