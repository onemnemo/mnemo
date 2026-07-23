/**
 * The find plugin: match highlights and the open flag, all view-only.
 *
 * Nothing this plugin does touches the document. Its state holds a
 * `DecorationSet` and a few flags, and it only ever produces transactions that
 * carry a meta, never a document step. The authority bumps the revision and
 * marks the note dirty strictly on `tr.docChanged`, so a highlight, an open, a
 * navigation between matches, none of them dirty the note, move `Ver`, or wake
 * autosave. View-only is a property of never changing the document, not a flag
 * that has to suppress a change, which is why there is no such flag here.
 *
 * The search itself does not run in this plugin. Re-projecting the document is
 * O(document) and must never happen on the typing frame; the React layer runs it
 * off a debounce and feeds fresh matches in through a meta. On a document change
 * this plugin only maps its decorations forward, which is cheap, and raises a
 * `stale` flag so the React layer knows to re-search.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { FindMatch } from './search';

export interface FindPluginState {
  readonly open: boolean;
  readonly matches: readonly FindMatch[];
  /** Index of the highlighted match, or -1 when there is none. */
  readonly activeIndex: number;
  readonly decorations: DecorationSet;
  /** The document changed since `matches` was computed; a re-search is owed. */
  readonly stale: boolean;
}

type FindMeta =
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | {
      readonly type: 'setSearch';
      readonly matches: readonly FindMatch[];
      readonly activeIndex: number;
    }
  | { readonly type: 'setActive'; readonly activeIndex: number };

export const findKey = new PluginKey<FindPluginState>('notes-find');

const EMPTY: FindPluginState = {
  open: false,
  matches: [],
  activeIndex: -1,
  decorations: DecorationSet.empty,
  stale: false,
};

export function getFindState(state: EditorState): FindPluginState {
  return findKey.getState(state) ?? EMPTY;
}

/** Dispatches a find meta on a bare, non-document transaction. */
export function dispatchFind(view: EditorView, meta: FindMeta): void {
  view.dispatch(view.state.tr.setMeta(findKey, meta));
}

function decorationsFor(
  doc: PMNode,
  matches: readonly FindMatch[],
  activeIndex: number,
): DecorationSet {
  const decos: Decoration[] = [];
  matches.forEach((match, index) => {
    const current = index === activeIndex;
    const className = current ? 'notes-find-match notes-find-match-current' : 'notes-find-match';
    if (match.backing === 'attr') {
      if (match.to > match.from) decos.push(Decoration.node(match.from, match.to, { class: className }));
      return;
    }
    // An inline decoration needs a real span; a range collapsed by an edit is
    // dropped rather than passed to ProseMirror as an empty decoration.
    if (match.to > match.from) decos.push(Decoration.inline(match.from, match.to, { class: className }));
  });
  return DecorationSet.create(doc, decos);
}

function mapMatches(matches: readonly FindMatch[], tr: Transaction): FindMatch[] {
  return matches.map((match) => ({
    ...match,
    from: tr.mapping.map(match.from, 1),
    to: tr.mapping.map(match.to, -1),
    blockPos: tr.mapping.map(match.blockPos, 1),
  }));
}

/**
 * The listeners the React overlay uses to observe plugin state. Kept off plugin
 * state (which is recomputed every transaction) and keyed by view so a second
 * editor never sees the first one's subscribers.
 */
const listeners = new WeakMap<EditorView, Set<(state: FindPluginState) => void>>();

export function subscribeFind(view: EditorView, listener: (state: FindPluginState) => void): () => void {
  const set = listeners.get(view) ?? new Set();
  set.add(listener);
  listeners.set(view, set);
  return () => {
    set.delete(listener);
  };
}

function notify(view: EditorView, state: FindPluginState): void {
  const set = listeners.get(view);
  if (!set) return;
  for (const listener of set) listener(state);
}

function isOpenShortcut(event: KeyboardEvent): boolean {
  if (event.key !== 'f' && event.key !== 'F') return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  return !event.shiftKey && !event.altKey;
}

export function findPlugin(): Plugin<FindPluginState> {
  return new Plugin<FindPluginState>({
    key: findKey,
    state: {
      init: () => EMPTY,
      apply(tr, old, _oldState, newState): FindPluginState {
        const meta = tr.getMeta(findKey) as FindMeta | undefined;

        if (meta?.type === 'open') {
          return old.open ? old : { ...old, open: true };
        }
        if (meta?.type === 'close') {
          return { ...EMPTY, open: false };
        }
        if (meta?.type === 'setSearch') {
          return {
            open: true,
            matches: meta.matches,
            activeIndex: meta.activeIndex,
            decorations: decorationsFor(newState.doc, meta.matches, meta.activeIndex),
            stale: false,
          };
        }
        if (meta?.type === 'setActive') {
          return {
            ...old,
            activeIndex: meta.activeIndex,
            decorations: decorationsFor(newState.doc, old.matches, meta.activeIndex),
          };
        }

        if (tr.docChanged && old.matches.length > 0) {
          const matches = mapMatches(old.matches, tr);
          return {
            ...old,
            matches,
            decorations: old.decorations.map(tr.mapping, tr.doc),
            stale: true,
          };
        }

        return old;
      },
    },
    props: {
      decorations(this: Plugin<FindPluginState>, state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty;
      },
      handleKeyDown(view, event) {
        if (isOpenShortcut(event)) {
          dispatchFind(view, { type: 'open' });
          return true;
        }
        if (event.key === 'Escape' && getFindState(view.state).open) {
          dispatchFind(view, { type: 'close' });
          return true;
        }
        return false;
      },
    },
    view(editorView) {
      return {
        update(view, prevState) {
          const next = getFindState(view.state);
          const prev = getFindState(prevState);
          if (next !== prev) notify(view, next);
        },
        destroy() {
          listeners.delete(editorView);
        },
      };
    },
  });
}
