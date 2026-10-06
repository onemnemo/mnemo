import { useEffect, useLayoutEffect, useState, type RefObject, type SyntheticEvent } from "react"

import type { Size } from "./geometry"
import { COMPACT_MAX_HEIGHT } from "./layout"

export interface ImageLoad {
  /** The image's own pixel size once the shown `<img>` has decoded it. */
  natural: Size | null
  failed: boolean
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void
  onError: () => void
}

/** Tracks the `<img>` the stage renders, so the image is fetched and decoded once and a failure is visible. */
export function useImageLoad(url: string | null, fetchFailed = false): ImageLoad {
  const [state, setState] = useState<{ url: string | null; natural: Size | null; failed: boolean }>({
    url,
    natural: null,
    failed: false,
  })
  if (state.url !== url) setState({ url, natural: null, failed: false })
  const current = state.url === url ? state : { natural: null, failed: false }

  return {
    natural: current.natural,
    failed: current.failed || fetchFailed,
    onLoad: (event) => {
      const { naturalWidth, naturalHeight } = event.currentTarget
      if (naturalWidth > 0 && naturalHeight > 0) setState({ url, natural: { w: naturalWidth, h: naturalHeight }, failed: false })
      else setState({ url, natural: null, failed: true })
    },
    onError: () => setState({ url, natural: null, failed: true }),
  }
}

function contentSize(element: HTMLElement): Size {
  const style = getComputedStyle(element)
  const pad = (a: string, b: string) => (parseFloat(a || "0") || 0) + (parseFloat(b || "0") || 0)
  return {
    w: element.clientWidth - pad(style.paddingLeft, style.paddingRight),
    h: element.clientHeight - pad(style.paddingTop, style.paddingBottom),
  }
}

function sameSize(a: Size, b: Size): boolean {
  return a.w === b.w && a.h === b.h
}

/** The content box of an element, kept current as it resizes. Zero until it is measured. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const read = () => setSize((old) => (sameSize(old, contentSize(element)) ? old : contentSize(element)))
    read()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}

/**
 * The room the nearest scrolling card column gives its card, or null when the card is not in one.
 * The column is found by attribute so the card does not need to be handed its parent.
 */
export function useColumnRoom(card: RefObject<HTMLElement | null>): Size | null {
  const [room, setRoom] = useState<Size | null>(null)

  useLayoutEffect(() => {
    const column = card.current?.closest<HTMLElement>("[data-card-column]")
    if (!column) return
    const read = () => setRoom((old) => (old && sameSize(old, contentSize(column)) ? old : contentSize(column)))
    read()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(read)
    observer.observe(column)
    return () => observer.disconnect()
  }, [card])

  return room
}

/** Card height minus the image row's: the padding, the question and the reserved answer block. */
export function chromeOf(cardHeight: number, rowHeight: number): number {
  return Math.max(0, cardHeight - rowHeight)
}

/**
 * Pixels the card spends on everything except the row holding the image. The row, not the image
 * box, is subtracted, so an answer sitting beside the image cannot feed back into the box height.
 */
export function useChrome(card: RefObject<HTMLElement | null>, row: RefObject<HTMLElement | null>): number {
  const [chrome, setChrome] = useState(0)

  useLayoutEffect(() => {
    const element = card.current
    if (!element) return
    const read = () => setChrome(chromeOf(element.offsetHeight, row.current?.offsetHeight ?? 0))
    read()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [card, row])

  return chrome
}

/** Whether the window is short enough that the answer goes beside the image. */
export function useCompactHeight(): boolean {
  const query = `(max-height: ${COMPACT_MAX_HEIGHT}px)`
  const [compact, setCompact] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches)

  useEffect(() => {
    if (typeof matchMedia !== "function") return
    const list = matchMedia(query)
    const update = () => setCompact(list.matches)
    update()
    list.addEventListener("change", update)
    return () => list.removeEventListener("change", update)
  }, [query])

  return compact
}
