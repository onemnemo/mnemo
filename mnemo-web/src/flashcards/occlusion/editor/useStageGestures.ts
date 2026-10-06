import { useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react"

import type { OcclusionDocument, OcclusionMask } from "../../facts/occlusion"
import { DRAG_THRESHOLD, maskBox, type Box, type Size } from "../geometry"
import { hitOrdered, masksInRect, pointToImage, rectBetween } from "./hit"
import { roomForMasks } from "./ids"
import { addMask, movePoint, moveMasks, resizeMask, setBox } from "./ops"
import { clamp01, unionBox, type Point } from "./shape"
import { snapMove, snapResize, type Guide } from "./snap"
import { MIN_MASK_PX } from "./state"
import type { EditorStore } from "./store"
import type { ResizeDir } from "@/mindmap/interaction/resize"

type Gesture =
  | { kind: "pan"; x: number; y: number }
  | { kind: "marquee"; start: Point; base: string[]; prior: string[] }
  | { kind: "move"; start: Point; base: OcclusionDocument; ids: string[]; collapseTo: string | null }
  | { kind: "resize"; id: string; dir: ResizeDir; base: OcclusionDocument }
  | { kind: "vertex"; id: string; index: number; base: OcclusionDocument }
  | { kind: "draw"; shape: "rect" | "ellipse"; id: string; start: Point; base: OcclusionDocument }

interface Live {
  gesture: Gesture
  pointerId: number
  /** The store's cancel count when the gesture began; a different value means Escape cancelled it. */
  epoch: number
  startX: number
  startY: number
  moved: boolean
  /** Set once a preview was written, so a draft that vanished means the gesture was cancelled. */
  previewed: boolean
}

export interface StageGestures {
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onMouseDown: (event: MouseEvent<HTMLElement>) => void
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: (event: PointerEvent<HTMLElement>) => void
    onPointerCancel: () => void
    onDoubleClick: (event: MouseEvent<HTMLElement>) => void
  }
  guides: Guide[]
  band: Box | null
  /** Where the pointer is while a polygon is being drawn, for the line from the last point. */
  cursor: Point | null
}

const SAME_SPOT_PX = 3

function boxesOf(document: OcclusionDocument, except: readonly string[]): Box[] {
  return document.masks.filter((mask) => !except.includes(mask.id)).map(maskBox)
}

/**
 * Turns pointer input over the stage into store calls. A drag previews a draft document and
 * commits once when it ends; Escape (which clears the draft) ends the gesture without a commit.
 */
export function useStageGestures(
  store: EditorStore,
  pane: RefObject<HTMLElement | null>,
  frame: Box,
  panHeld: boolean,
  ordered: readonly OcclusionMask[],
): StageGestures {
  const live = useRef<Live | null>(null)
  const latest = useRef({ frame, panHeld, ordered })
  latest.current = { frame, panHeld, ordered }
  const hit = (point: Point) => hitOrdered(latest.current.ordered, point)

  const [guides, setGuides] = useState<Guide[]>([])
  const [band, setBand] = useState<Box | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)

  const shown = (): Size => ({ w: latest.current.frame.w, h: latest.current.frame.h })
  const pointOf = (event: { clientX: number; clientY: number }): Point => {
    const rect = pane.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    return pointToImage({ x: event.clientX, y: event.clientY }, rect, latest.current.frame)
  }
  const clampedPoint = (event: { clientX: number; clientY: number }): Point => {
    const [x, y] = pointOf(event)
    return [clamp01(x), clamp01(y)]
  }

  const end = () => {
    live.current = null
    store.endGesture()
    setGuides([])
    setBand(null)
  }

  const begin = (event: PointerEvent<HTMLElement>, gesture: Gesture) => {
    live.current = {
      gesture,
      pointerId: event.pointerId,
      epoch: store.getState().gesture.epoch,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      previewed: false,
    }
    store.beginGesture()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* a pointer that is already gone only loses the retargeting */
    }
  }

  const placePolygonPoint = (event: PointerEvent<HTMLElement>) => {
    const point = clampedPoint(event)
    const last = store.getState().pending?.at(-1)
    const size = shown()
    if (last && Math.hypot((point[0] - last[0]) * size.w, (point[1] - last[1]) * size.h) < SAME_SPOT_PX) return
    store.addPoint(point)
    if (!last) setCursor(point)
  }

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (live.current || event.isPrimary === false) return
    const state = store.getState()
    const point = pointOf(event)

    if (event.button === 1 || (event.button === 0 && (state.tool === "pan" || latest.current.panHeld))) {
      event.preventDefault()
      begin(event, { kind: "pan", x: event.clientX, y: event.clientY })
      return
    }

    if (event.button === 2) {
      const under = hit(point)
      if (under && !state.selection.includes(under.id)) store.select([under.id])
      return
    }
    if (event.button !== 0) return

    if (state.tool === "polygon") {
      placePolygonPoint(event)
      return
    }
    if (state.tool === "rect" || state.tool === "ellipse") {
      if (!roomForMasks(state.history.present)) {
        store.env.onFull?.()
        return
      }
      const start: Point = [clamp01(point[0]), clamp01(point[1])]
      begin(event, { kind: "draw", shape: state.tool, id: store.mint(), start, base: state.history.present })
      return
    }

    const target = event.target instanceof Element ? event.target : null
    const handle = target?.closest<HTMLElement>("[data-handle]")
    const vertex = target?.closest<HTMLElement>("[data-vertex]")
    const only = state.selection.length === 1 ? state.selection[0] : null
    if (handle && only) {
      begin(event, { kind: "resize", id: only, dir: handle.dataset.handle as ResizeDir, base: state.history.present })
      return
    }
    if (vertex && only) {
      begin(event, { kind: "vertex", id: only, index: Number(vertex.dataset.vertex), base: state.history.present })
      return
    }

    const top = hit(point)
    if (!top) {
      const base = event.shiftKey ? state.selection : []
      if (!event.shiftKey) store.clearSelection()
      begin(event, { kind: "marquee", start: point, base, prior: state.selection })
      return
    }

    if (event.shiftKey) {
      store.select([top.id], "toggle")
      if (!store.getState().selection.includes(top.id)) return
    } else if (!state.selection.includes(top.id)) {
      store.select([top.id])
    }
    const selection = store.getState().selection
    // A press on one of several selected masks only narrows the selection if it turns out to be a click.
    const collapseTo = !event.shiftKey && selection.length > 1 && state.selection.includes(top.id) ? top.id : null
    begin(event, { kind: "move", start: point, base: store.getState().history.present, ids: selection, collapseTo })
  }

  const drag = (l: Live, event: PointerEvent<HTMLElement>) => {
    const g = l.gesture
    const size = shown()
    const free = event.altKey
    const point = pointOf(event)

    switch (g.kind) {
      case "pan":
        store.panByPixels(event.clientX - g.x, event.clientY - g.y)
        g.x = event.clientX
        g.y = event.clientY
        return
      case "marquee": {
        const area = rectBetween(g.start, clampedPoint(event))
        store.select([...g.base, ...masksInRect(store.doc(), area)])
        setBand(area)
        return
      }
      case "move": {
        const dx = point[0] - g.start[0]
        const dy = point[1] - g.start[1]
        const union = unionBox(g.base.masks.filter((mask) => g.ids.includes(mask.id)))
        const snap = free ? { dx: 0, dy: 0, guides: [] } : snapMove({ ...union, x: union.x + dx, y: union.y + dy }, boxesOf(g.base, g.ids), size)
        store.preview(moveMasks(g.base, g.ids, dx + snap.dx, dy + snap.dy))
        setGuides(snap.guides)
        break
      }
      case "resize": {
        const options = { size, minPx: MIN_MASK_PX, lockAspect: event.shiftKey }
        const resized = resizeMask(g.base, g.id, g.dir, event.clientX - l.startX, event.clientY - l.startY, options)
        const mask = resized.masks.find((m) => m.id === g.id)
        if (!mask) return
        const snap = free ? null : snapResize(maskBox(mask), g.dir, boxesOf(g.base, [g.id]), size)
        const big = snap && snap.box.w * size.w >= MIN_MASK_PX && snap.box.h * size.h >= MIN_MASK_PX
        store.preview(big ? setBox(resized, g.id, snap.box) : resized)
        setGuides(big ? snap.guides : [])
        break
      }
      case "vertex":
        store.preview(movePoint(g.base, g.id, g.index, clampedPoint(event)))
        break
      case "draw": {
        const area = rectBetween(g.start, clampedPoint(event))
        store.preview(addMask(g.base, { shape: g.shape, ...area }, g.id).document)
        break
      }
    }
    l.previewed = true
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const l = live.current
    if (l && event.pointerId !== l.pointerId) return
    if (!l) {
      if (event.buttons !== 0) return
      const state = store.getState()
      if (state.pending) setCursor(clampedPoint(event))
      store.setHovered(state.tool === "select" ? (hit(pointOf(event))?.id ?? null) : null)
      return
    }
    // A release outside the window that capture missed leaves no pointerup to end the gesture.
    if (event.buttons === 0) {
      store.cancelDraft()
      end()
      return
    }
    if (cancelled(l) || (l.previewed && store.getState().draft === null)) {
      end()
      return
    }
    if (!l.moved && Math.hypot(event.clientX - l.startX, event.clientY - l.startY) <= DRAG_THRESHOLD) return
    l.moved = true
    drag(l, event)
  }

  /** Escape cancelled the gesture; a marquee puts back the selection it started from. */
  const cancelled = (l: Live): boolean => {
    if (store.getState().gesture.epoch === l.epoch) return false
    if (l.gesture.kind === "marquee") store.select(l.gesture.prior)
    return true
  }

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const l = live.current
    if (!l || event.pointerId !== l.pointerId) return
    if (cancelled(l)) {
      end()
      return
    }
    const g = l.gesture
    const size = shown()
    const kept = store.getState().draft !== null

    if (g.kind === "move") {
      if (l.moved && kept) store.commitDraft()
      else if (!l.moved && g.collapseTo) store.select([g.collapseTo])
    } else if (g.kind === "resize" || g.kind === "vertex") {
      if (l.moved && kept) store.commitDraft()
      else store.cancelDraft()
    } else if (g.kind === "draw") {
      const area = rectBetween(g.start, clampedPoint(event))
      const big = area.w * size.w >= MIN_MASK_PX && area.h * size.h >= MIN_MASK_PX
      if (l.moved && kept && big) store.commitDraft({ select: [g.id] })
      else store.cancelDraft()
    }
    end()
  }

  // Windows starts autoscroll from mousedown, which a pointerdown default prevention does not stop.
  const onMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button === 1) event.preventDefault()
  }

  const onPointerCancel = () => {
    store.cancelDraft()
    end()
  }

  const onDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const state = store.getState()
    if (state.tool === "polygon") {
      store.finishPolygon()
      return
    }
    if (state.tool !== "select") return
    const under = hit(pointOf(event))
    if (!under) return
    store.select([under.id])
    store.env.onRename?.(under.id)
  }

  return {
    handlers: { onPointerDown, onMouseDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick },
    guides,
    band,
    cursor: store.getState().pending ? cursor : null,
  }
}
