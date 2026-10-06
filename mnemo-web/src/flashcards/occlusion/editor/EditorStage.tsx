import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react"

import { useT } from "@/i18n/useT"

import { badgeVisible, fitSize, polygonPoints } from "../geometry"
import { useElementSize, useImageLoad } from "../hooks"
import { drawOrder } from "./cards"
import { MaskHandles } from "./MaskHandles"
import { maskName } from "./mask-name"
import { polygonRing, polygonStyle, type Ring } from "./mask-style"
import { MaskView } from "./MaskView"
import { frameOf } from "./state"
import { MarqueeBand, PendingPolygon, SnapGuides } from "./StageOverlays"
import type { OcclusionEditor } from "./useOcclusionEditor"
import { useSpaceHeld } from "./useSpaceHeld"
import { useStageGestures } from "./useStageGestures"

/** Wheel pixels that make one e-fold of zoom, so a pinch and a notched wheel both feel even. */
const WHEEL_ZOOM_RATE = 0.0015

export interface EditorStageProps {
  editor: OcclusionEditor
  imageUrl: string | null
  /** The image's bytes could not be fetched, which no `<img>` error reports. */
  imageFailed?: boolean
  /** Room kept around the image at fit, in pixels. */
  margin?: number
}

/**
 * The image on paper with its masks, selection, handles and drawing tools. All state lives in the
 * editor controller; this component measures, draws and turns pointer input into store calls.
 */
export function EditorStage({ editor, imageUrl, imageFailed = false, margin = 32 }: EditorStageProps) {
  const t = useT()
  const { store, state, document, cards } = editor
  const pane = useRef<HTMLDivElement | null>(null)
  const box = useElementSize(pane)
  const image = useImageLoad(imageUrl, imageFailed)

  const roomW = Math.max(0, box.w - margin * 2)
  const roomH = Math.max(0, box.h - margin * 2)
  const fitted = useMemo(() => fitSize(image.natural ?? { w: 0, h: 0 }, { w: roomW, h: roomH }), [image.natural, roomW, roomH])
  useLayoutEffect(() => {
    store.setMetrics({ box, fitted, natural: image.natural })
  }, [store, box, fitted, image.natural])

  const frame = frameOf({ metrics: { box, fitted, natural: image.natural }, view: state.view })
  const panHeld = useSpaceHeld(pane)
  const placed = useMemo(() => drawOrder(document), [document])
  const gestures = useStageGestures(store, pane, frame, panHeld, placed)

  useWheelZoom(pane, store)

  const cardOfMask = useMemo(() => new Map(cards.flatMap((card) => card.ids.map((id) => [id, card] as const))), [cards])
  const selected = useMemo(() => new Set(state.selection), [state.selection])
  const hoveredCard = state.hovered ? cardOfMask.get(state.hovered) : undefined
  const hoveredIds = useMemo(() => new Set(hoveredCard?.ids ?? []), [hoveredCard])
  const primary = placed.find((mask) => selected.has(mask.id))?.id ?? placed[0]?.id

  const elements = useRef(new Map<string, HTMLDivElement>())
  const register = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) elements.current.set(id, element)
    else elements.current.delete(id)
  }, [])
  const onActivate = useCallback(
    (id: string) => {
      const state = store.getState()
      if (!state.pending && state.tool === "select") store.select([id])
    },
    [store],
  )

  // Selection can move without the pointer, such as the bracket keys; focus follows so the roving stop stays with it.
  useEffect(() => {
    const active = window.document.activeElement
    const target = primary ? elements.current.get(primary) : undefined
    if (target && active && active !== target && pane.current?.contains(active)) target.focus({ preventScroll: true })
  }, [primary])

  const ready = image.natural !== null && frame.w > 0
  const only = state.selection.length === 1 ? placed.find((mask) => mask.id === state.selection[0]) : undefined
  const cursor = state.tool === "pan" || panHeld ? "grab" : state.tool === "select" ? undefined : "crosshair"

  return (
    <div
      ref={pane}
      data-testid="occlusion-editor-stage"
      className="relative size-full overflow-hidden bg-canvas-sunken select-none"
      tabIndex={-1}
      style={{ cursor, touchAction: "none" }}
      onPointerLeave={() => store.setHovered(null)}
      {...gestures.handlers}
      onPointerDown={(event) => {
        // The pane is the key target after a click; a mask press focuses its own option instead.
        if (event.target === event.currentTarget || !(event.target as Element).closest("[role=option]")) {
          event.currentTarget.focus({ preventScroll: true })
        }
        gestures.handlers.onPointerDown(event)
      }}
    >
      <div
        data-testid="editor-frame"
        className="absolute shadow-canvas"
        style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, background: "var(--paper)" }}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            decoding="async"
            className="pointer-events-none absolute top-0 left-0 size-full"
            style={{ opacity: image.natural ? 1 : 0 }}
            onLoad={image.onLoad}
            onError={image.onError}
          />
        )}
        {ready && (
          <>
            <svg
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
            >
              {placed
                .filter((mask) => mask.shape === "polygon" && mask.points)
                .map((mask) => {
                  const ring = ringOf(mask.id, selected, hoveredIds)
                  return (
                    <g key={mask.id} data-mask-shape={mask.id}>
                      <polygon points={polygonPoints(mask.points!)} style={polygonStyle(state.showMasks)} />
                      {ring !== "none" && <polygon points={polygonPoints(mask.points!)} style={polygonRing(ring)} />}
                    </g>
                  )
                })}
            </svg>
            <div
              role="listbox"
              aria-multiselectable="true"
              aria-label={t("Flashcards", "OcclusionStageLabel")}
              className="pointer-events-none absolute inset-0"
            >
              {placed.map((mask) => {
                const card = cardOfMask.get(mask.id)
                const ring = ringOf(mask.id, selected, hoveredIds)
                return (
                  <MaskView
                    key={mask.id}
                    mask={mask}
                    number={card?.number ?? 0}
                    name={card ? maskName(t, { ...card, label: mask.label ?? "" }) : mask.id}
                    grouped={Boolean(card?.grouped)}
                    ring={ring}
                    selected={selected.has(mask.id)}
                    tabbable={mask.id === primary}
                    badge={badgeVisible({
                      maskCount: document.masks.length,
                      maskHeightPx: mask.h * frame.h,
                      selected: selected.has(mask.id),
                      grouped: Boolean(card?.grouped),
                      hovered: hoveredIds.has(mask.id),
                      zoom: state.view.scale,
                    })}
                    frameW={frame.w}
                    frameH={frame.h}
                    showMasks={state.showMasks}
                    onActivate={onActivate}
                    register={register}
                  />
                )
              })}
            </div>
            <div className="pointer-events-none absolute inset-0">
              {only && state.tool === "select" && <MaskHandles mask={only} heightPx={only.h * frame.h} />}
              <SnapGuides guides={gestures.guides} />
              {gestures.band && <MarqueeBand band={gestures.band} />}
              {state.pending && <PendingPolygon points={state.pending} cursor={gestures.cursor} />}
            </div>
          </>
        )}
      </div>
      {image.failed && (
        <p role="status" className="absolute inset-0 m-0 grid place-items-center p-4 text-center text-[13px] text-ink-3">
          {t("Flashcards", "StudyOcclusionImageFailed")}
        </p>
      )}
    </div>
  )
}

function ringOf(id: string, selected: ReadonlySet<string>, hovered: ReadonlySet<string>): Ring {
  if (selected.has(id)) return "selected"
  return hovered.has(id) ? "hover" : "none"
}

/** Ctrl or Cmd with the wheel zooms about the pointer; a plain wheel pans. Native so it can cancel the scroll. */
function useWheelZoom(pane: RefObject<HTMLElement | null>, store: OcclusionEditor["store"]) {
  useEffect(() => {
    const element = pane.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect()
        store.zoomBy(Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), { x: event.clientX - rect.left, y: event.clientY - rect.top })
        return
      }
      const horizontal = event.shiftKey && event.deltaX === 0
      store.panByPixels(horizontal ? -event.deltaY : -event.deltaX, horizontal ? 0 : -event.deltaY)
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [pane, store])
}
