import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { buildOcclusionUnits, type OcclusionDocument } from "../../facts/occlusion"
import { cardList, isExactlyOneGroup, type CardEntry } from "./cards"
import type { EditorAction } from "./keys"
import { handleKey } from "./keys"
import { perform } from "./perform"
import { docOf, zoomPercent, type EditorState } from "./state"
import { createEditorStore, type EditorEnv, type EditorStore } from "./store"

export interface OcclusionEditor {
  /** Every change goes through the store's methods; components never write state directly. */
  store: EditorStore
  state: EditorState
  /** The document to draw: the in-flight draft, else the last committed. */
  document: OcclusionDocument
  /** Cards in order, each with its number, member ids and joined label. */
  cards: CardEntry[]
  selection: string[]
  /** Keys two cards would share. Always empty from the editor; a loaded document can carry some. */
  collisions: string[]
  /** The selection is exactly one group, so the bar reads Ungroup. */
  selectionIsGroup: boolean
  canUndo: boolean
  canRedo: boolean
  /** The zoom readout in percent, or null before the image has loaded. */
  zoomPercent: number | null
  /** Runs an action; false when it had nothing to do. */
  perform: (action: EditorAction) => boolean
  /** A keydown handler for the editor's root; returns whether the key was used. */
  onKeyDown: (event: KeyboardEvent) => boolean
}

/**
 * The editor's controller for the surface around it. Seed it with the parsed Masks field; it calls
 * `env.onChange` with each committed document so the owner can write the field back.
 */
export function useOcclusionEditor(initial: OcclusionDocument, env: EditorEnv = {}): OcclusionEditor {
  const latest = useRef(env)
  useLayoutEffect(() => {
    latest.current = env
  })

  const [store] = useState(() =>
    createEditorStore(initial, {
      random: env.random,
      now: env.now,
      onChange: (document) => latest.current.onChange?.(document),
      onRename: (id) => latest.current.onRename?.(id),
      onFull: () => latest.current.onFull?.(),
    }),
  )
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const document = docOf(state)
  const cards = useMemo(() => cardList(document), [document])
  const collisions = useMemo(() => buildOcclusionUnits(document).collisions, [document])

  const run = useCallback((action: EditorAction) => perform(store, action), [store])
  const onKeyDown = useCallback((event: KeyboardEvent) => handleKey(event, run), [run])

  return {
    store,
    state,
    document,
    cards,
    selection: state.selection,
    collisions,
    selectionIsGroup: isExactlyOneGroup(document, state.selection),
    canUndo: state.history.past.length > 0,
    canRedo: state.history.future.length > 0,
    zoomPercent: zoomPercent(state),
    perform: run,
    onKeyDown,
  }
}
