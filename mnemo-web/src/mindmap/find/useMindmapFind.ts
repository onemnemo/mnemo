/**
 * Find inside the open map: the query, the matches it walks, and the camera move to each one.
 *
 * The bar owns no search logic; this asks the server, which searches the same full-text mirror the
 * assistant does, and keeps the answer in scene order so the walk reads left to right and top to
 * bottom rather than in the order nodes happened to be written.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

import type { CanvasRuntime } from "../canvas/runtime"
import type { Scene } from "../model/scene"
import { findInMindmap } from "./api"
import { cameraOn, inSceneOrder, stepIndex } from "./matches"

/** Long enough to fold a burst of keystrokes into one request, short enough not to read as lag. */
const DEBOUNCE_MS = 150

export interface MindmapFindOptions {
  mapId: string | null
  /** Bumped by every edit, so an open bar searches the map as it is now rather than as it was opened on. */
  revision: number | undefined
  scene: Scene | null
  runtime: RefObject<CanvasRuntime | null>
  /** The pane the camera is sized against, whose canvas takes the keyboard back when the bar closes. */
  pane: RefObject<HTMLElement | null>
  /** A match was walked to. The route selects it, which is what marks it on the canvas. */
  onReveal: (id: string) => void
}

export interface MindmapFind {
  open: boolean
  query: string
  /** How many matches the walk covers. */
  count: number
  /**
   * The place the walk continues from, or negative one when there is none. After a refresh it
   * can sit on a match that has not been shown, since a refresh never moves the camera.
   */
  index: number
  /** Counts the times the bar was asked for, so a Ctrl+F on an open bar puts the caret back in it. */
  opened: number
  show(): void
  close(): void
  setQuery(next: string): void
  next(): void
  previous(): void
}

export function useMindmapFind({ mapId, revision, scene, runtime, pane, onReveal }: MindmapFindOptions): MindmapFind {
  const [open, setOpen] = useState(false)
  const [opened, setOpened] = useState(0)
  const [query, setQueryState] = useState("")
  const [hits, setHits] = useState<readonly string[]>([])
  const [index, setIndex] = useState(-1)

  // Read at answer time rather than captured by the effect, so a theme flip or a template change,
  // which reprojects the scene without changing what is in it, does not send the query again.
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const revealRef = useRef(onReveal)
  revealRef.current = onReveal
  const hitsRef = useRef(hits)
  hitsRef.current = hits
  const indexRef = useRef(index)
  indexRef.current = index
  // Whether the next answer is for a query the user changed, which walks to its first match, or a
  // refresh after an edit, which keeps the place and leaves the camera where it is.
  const fresh = useRef(false)

  const reveal = useCallback(
    (id: string) => {
      const created = runtime.current
      const box = created?.index().boxOf(id)
      if (created && box) {
        const width = pane.current?.clientWidth ?? 0
        const height = pane.current?.clientHeight ?? 0
        created.setViewport(cameraOn(box, width, height, created.viewport().zoom))
      }
      revealRef.current(id)
    },
    [pane, runtime],
  )

  const goTo = useCallback(
    (next: number) => {
      setIndex(next)
      const id = hitsRef.current[next]
      if (id !== undefined) {
        reveal(id)
      }
    },
    [reveal],
  )

  useEffect(() => {
    const text = query.trim()
    if (!open || !mapId || text.length === 0) {
      setHits([])
      setIndex(-1)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void findInMindmap(mapId, text, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) {
            return
          }
          const held = sceneRef.current
          const ordered = held
            ? inSceneOrder(
                result.hits.map((hit) => hit.elementId),
                held,
              )
            : []
          setHits(ordered)
          const wasFresh = fresh.current
          fresh.current = false
          const current = hitsRef.current[indexRef.current]
          const kept = wasFresh || current === undefined ? -1 : ordered.indexOf(current)
          if (kept >= 0) {
            setIndex(kept)
            return
          }
          if (!wasFresh) {
            // A refresh after an edit leaves the camera with the user: when the match they were on
            // is gone, or there was none, the place moves to the nearest surviving match without
            // being shown, and the next Enter walks from there.
            setIndex(ordered.length > 0 ? Math.min(Math.max(indexRef.current, 0), ordered.length - 1) : -1)
            return
          }
          setIndex(ordered.length > 0 ? 0 : -1)
          if (ordered.length > 0) {
            reveal(ordered[0])
          }
        })
        .catch((error: unknown) => {
          // A request superseded by the next keystroke is not a failure, and nothing here can do
          // anything about one that is: the bar shows no matches and the next keystroke asks again.
          if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
            setHits([])
            setIndex(-1)
          }
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, mapId, revision, reveal])

  const setQuery = useCallback((next: string) => {
    fresh.current = true
    setQueryState(next)
  }, [])

  // Closing unmounts the focused field and focus would fall to the body, where no map key is
  // heard again until a click, so the canvas takes it back the way it does when a label field closes.
  const close = useCallback(() => {
    setOpen(false)
    setQueryState("")
    pane.current?.querySelector<HTMLElement>("[data-mm-canvas]")?.focus({ preventScroll: true })
  }, [pane])

  return {
    open,
    query,
    count: hits.length,
    index,
    opened,
    show: useCallback(() => {
      setOpen(true)
      setOpened((n) => n + 1)
    }, []),
    close,
    setQuery,
    next: useCallback(() => goTo(stepIndex(indexRef.current, hitsRef.current.length, 1)), [goTo]),
    previous: useCallback(() => goTo(stepIndex(indexRef.current, hitsRef.current.length, -1)), [goTo]),
  }
}
