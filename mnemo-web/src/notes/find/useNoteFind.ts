/**
 * The find/replace controller: the React side of the find plugin.
 *
 * The plugin owns the highlights, the open flag and the live match list. This
 * hook owns the query, the options and the replacement, runs the search, and
 * drives navigation and replace. The two talk through metas and a subscription,
 * never by sharing mutable state.
 *
 * The search is debounced and only ever runs here, never inside a transaction.
 * A note edit maps the existing highlights forward on the typing frame (cheap)
 * and raises a stale flag; this hook re-projects and re-searches once the edit
 * settles. That is the "no synchronous full-document rescan per keystroke"
 * contract: the O(document) projection is off the typing frame, and a keystroke
 * in the find box reuses the cached projection and only re-scans the flattened
 * text.
 *
 * A revisioned worker index (search on a background thread, results tagged with
 * a document revision) is the eventual target and is deliberately
 * deferred. The synchronous path here is correct and does not rescan per
 * keystroke; the worker is a performance move for very large notes, earned by a
 * measurement rather than assumed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { BlockRegistry } from '../editor/registry/build';
import { buildReplaceAll, buildReplaceOne } from './replace';
import {
  dispatchFind,
  getFindState,
  subscribeFind,
  type FindPluginState,
} from './find-plugin';
import { scrollToMatch } from './navigate';
import { projectionOf, searchDocument, type FindMatch, type FindOptions } from './search';

const SEARCH_DEBOUNCE_MS = 150;

export interface NoteFind {
  readonly open: boolean;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly replaceOpen: boolean;
  readonly replaceText: string;
  readonly count: number;
  readonly activeIndex: number;
  setQuery(value: string): void;
  setReplaceText(value: string): void;
  toggleCaseSensitive(): void;
  toggleWholeWord(): void;
  toggleReplaceOpen(): void;
  next(): void;
  previous(): void;
  replaceCurrent(): void;
  replaceAll(): void;
  close(): void;
}

/** A single-line, non-empty editor selection worth seeding the query with. */
function selectionSeed(view: EditorView): string | null {
  const { selection } = view.state;
  if (selection.empty) return null;
  const text = view.state.doc.textBetween(selection.from, selection.to, '\n');
  if (text.length === 0 || text.includes('\n')) return null;
  return text;
}

export function useNoteFind(view: EditorView | null, registry: BlockRegistry): NoteFind {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceText, setReplaceTextState] = useState('');
  const [count, setCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Refs mirror the reactive values so the imperative callbacks below read the
  // current search state without being rebuilt on every keystroke.
  const queryRef = useRef(query);
  const optionsRef = useRef<FindOptions>({ caseSensitive, wholeWord });
  const replaceTextRef = useRef(replaceText);
  const openRef = useRef(open);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  queryRef.current = query;
  optionsRef.current = { caseSensitive, wholeWord };
  replaceTextRef.current = replaceText;
  openRef.current = open;

  const clearDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  /**
   * Runs the search now against the live document and feeds the plugin.
   *
   * `preserve` keeps the highlighted match near where it was, by short id and
   * offset, so an edit or a replace does not throw the reader back to the top.
   */
  const searchNow = useCallback(
    (preserve?: { readonly sid: string; readonly start: number; readonly index: number }) => {
      if (!view) return;
      const projection = projectionOf(view.state.doc, registry);
      const matches = searchDocument(projection, queryRef.current, optionsRef.current, view.state.doc);

      let index = matches.length > 0 ? 0 : -1;
      if (preserve && matches.length > 0) {
        const exact = matches.findIndex(
          (match) => match.sid === preserve.sid && match.localRange.start === preserve.start,
        );
        index = exact >= 0 ? exact : Math.min(preserve.index, matches.length - 1);
      }

      dispatchFind(view, { type: 'setSearch', matches, activeIndex: index });
    },
    [view, registry],
  );

  const scheduleSearch = useCallback(
    (preserve?: { readonly sid: string; readonly start: number; readonly index: number }) => {
      clearDebounce();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        searchNow(preserve);
      }, SEARCH_DEBOUNCE_MS);
    },
    [clearDebounce, searchNow],
  );

  // Mirror plugin state into React, and re-search when an edit left it stale.
  useEffect(() => {
    if (!view) return;
    const onChange = (state: FindPluginState) => {
      const wasOpen = openRef.current;
      // Record the open state synchronously, before the search below. searchNow
      // dispatches a setSearch meta, which ProseMirror applies synchronously and
      // notifies right back into this handler; without updating the ref first,
      // that re-entrant call would still see the old `false` and search again,
      // recursing without bound. React's render-time write happens too late.
      openRef.current = state.open;
      setOpen(state.open);
      setCount(state.matches.length);
      setActiveIndex(state.activeIndex);

      // Opened from the editor (Ctrl+F): seed the query from a selection the
      // first time, then search whatever query is present.
      if (state.open && !wasOpen) {
        if (queryRef.current.length === 0) {
          const seed = selectionSeed(view);
          if (seed) {
            queryRef.current = seed;
            setQueryState(seed);
          }
        }
        if (queryRef.current.length > 0) searchNow();
      }

      if (state.stale && state.open) {
        const active = state.matches[state.activeIndex];
        scheduleSearch(
          active
            ? { sid: active.sid, start: active.localRange.start, index: state.activeIndex }
            : undefined,
        );
      }
    };
    return subscribeFind(view, onChange);
  }, [view, searchNow, scheduleSearch]);

  useEffect(() => () => clearDebounce(), [clearDebounce]);

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value);
      queryRef.current = value;
      scheduleSearch();
    },
    [scheduleSearch],
  );

  const setReplaceText = useCallback((value: string) => {
    setReplaceTextState(value);
    replaceTextRef.current = value;
  }, []);

  const toggleCaseSensitive = useCallback(() => {
    setCaseSensitive((prev) => {
      const next = !prev;
      optionsRef.current = { ...optionsRef.current, caseSensitive: next };
      searchNow();
      return next;
    });
  }, [searchNow]);

  const toggleWholeWord = useCallback(() => {
    setWholeWord((prev) => {
      const next = !prev;
      optionsRef.current = { ...optionsRef.current, wholeWord: next };
      searchNow();
      return next;
    });
  }, [searchNow]);

  const toggleReplaceOpen = useCallback(() => {
    setReplaceOpen((prev) => !prev);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!view) return;
      const state = getFindState(view.state);
      const total = state.matches.length;
      if (total === 0) return;
      const current = state.activeIndex;
      const index = current < 0 ? (direction > 0 ? 0 : total - 1) : (current + direction + total) % total;
      dispatchFind(view, { type: 'setActive', activeIndex: index });
      // `setActive` re-styles the highlight; scroll the freshly active match in.
      const match: FindMatch | undefined = getFindState(view.state).matches[index];
      if (match) scrollToMatch(view, match);
    },
    [view],
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  const replaceCurrent = useCallback(() => {
    if (!view) return;
    const state = getFindState(view.state);
    const match = state.matches[state.activeIndex];
    if (!match) return;
    const tr = buildReplaceOne(view.state, match, replaceTextRef.current);
    if (!tr) {
      // The match no longer describes the document; refresh rather than write.
      searchNow();
      return;
    }
    const keepAt = state.activeIndex;
    view.dispatch(tr);
    // The replaced match is gone; the next one shifts into its index.
    searchNow({ sid: match.sid, start: match.localRange.start, index: keepAt });
  }, [view, searchNow]);

  const replaceAll = useCallback(() => {
    if (!view) return;
    const result = buildReplaceAll(
      view.state,
      registry,
      queryRef.current,
      optionsRef.current,
      replaceTextRef.current,
    );
    if (!result) return;
    view.dispatch(result.tr);
    searchNow();
  }, [view, registry, searchNow]);

  const close = useCallback(() => {
    if (!view) return;
    clearDebounce();
    dispatchFind(view, { type: 'close' });
    view.focus();
  }, [view, clearDebounce]);

  return {
    open,
    query,
    caseSensitive,
    wholeWord,
    replaceOpen,
    replaceText,
    count,
    activeIndex,
    setQuery,
    setReplaceText,
    toggleCaseSensitive,
    toggleWholeWord,
    toggleReplaceOpen,
    next,
    previous,
    replaceCurrent,
    replaceAll,
    close,
  };
}
