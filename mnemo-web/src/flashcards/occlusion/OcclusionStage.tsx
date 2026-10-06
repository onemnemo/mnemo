import { useEffect, useMemo, useRef, type MouseEvent, type PointerEvent, type Ref } from "react"

import { useT } from "@/i18n/useT"

import type { OcclusionMaskDto } from "@/api/types"

import type { ImageLoad } from "./hooks"
import { DRAG_THRESHOLD, panBy, viewFrame, zoomAt, type Size, type View } from "./geometry"
import { OcclusionMasks } from "./OcclusionMasks"
import { placeMasks } from "./placement"

const WHEEL_ZOOM = 1.25

export interface OcclusionStageProps {
  masks: OcclusionMaskDto[]
  askedIds: string[]
  mode: "hideAll" | "hideOne"
  side: "front" | "back"
  showMasks: boolean
  imageUrl: string | null
  /** Load state of the image; masks are only drawn over a decoded image. */
  image: ImageLoad
  box: Size
  fitted: Size
  view: View
  onViewChange: (view: View) => void
  label: string
  boxRef?: Ref<HTMLDivElement>
}

/**
 * The image, its masks and the pan and zoom over them. A drag over the image pans it and never
 * counts as a click, so the card around it does not read the gesture as a reveal.
 */
export function OcclusionStage(props: OcclusionStageProps) {
  const { box, fitted, view, onViewChange } = props
  const frame = viewFrame(view, box, fitted)
  const gesture = useRef({ active: false, x: 0, y: 0, startX: 0, startY: 0, moved: false, swallow: false })
  const root = useRef<HTMLDivElement | null>(null)

  // The listener is native because React registers wheel as passive, and a zoom has to cancel the scroll.
  const latest = useRef({ view, box, fitted, onViewChange })
  latest.current = { view, box, fitted, onViewChange }
  useEffect(() => {
    const element = root.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      const { view: current, box: room, fitted: size, onViewChange: change } = latest.current
      // Plain wheel scrolls the card column until the image is zoomed; a pinch arrives as ctrl+wheel.
      if (current.scale <= 1 && !event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      change(zoomAt(current, event.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, anchor, room, size))
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [])

  const setRoot = (element: HTMLDivElement | null) => {
    root.current = element
    if (typeof props.boxRef === "function") props.boxRef(element)
    else if (props.boxRef) props.boxRef.current = element
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const g = gesture.current
    g.active = true
    g.moved = false
    g.swallow = false
    g.x = g.startX = event.clientX
    g.y = g.startY = event.clientY
    // Captured so the click that ends a drag lands here, where it can be swallowed, rather than on
    // whatever the pointer was released over.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* an unsupported or already released pointer only loses the retargeting */
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g.active) return
    // A release outside the stage that capture did not catch leaves no pointerup to end the gesture.
    if (event.buttons === 0) {
      endGesture(false)
      return
    }
    if (!g.moved && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > DRAG_THRESHOLD) g.moved = true
    if (!g.moved) return
    if (view.scale > 1) onViewChange(panBy(view, event.clientX - g.x, event.clientY - g.y, box, fitted))
    g.x = event.clientX
    g.y = event.clientY
  }

  // Only a pointerup is followed by a click, so only it can leave one to swallow.
  const endGesture = (clicks: boolean) => {
    const g = gesture.current
    g.swallow = clicks && g.moved
    g.active = false
  }

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!gesture.current.swallow) return
    gesture.current.swallow = false
    event.stopPropagation()
  }

  const t = useT()
  const { masks, askedIds, mode, side, showMasks, image } = props
  const placed = useMemo(
    () => (image.natural ? placeMasks(masks, askedIds, mode, side, showMasks) : []),
    [image.natural, masks, askedIds, mode, side, showMasks],
  )

  return (
    <div
      ref={setRoot}
      role="img"
      // Children of an img are hidden from assistive tech, so the failure has to be in the name.
      aria-label={image.failed ? `${t("Flashcards", "StudyOcclusionImageFailed")} ${props.label}` : props.label}
      data-testid="occlusion-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endGesture(true)}
      onPointerCancel={() => endGesture(false)}
      onLostPointerCapture={() => gesture.current.active && endGesture(false)}
      onClick={onClick}
      className="relative shrink-0 overflow-hidden rounded-md bg-canvas-sunken select-none"
      style={{
        width: box.w,
        height: box.h,
        touchAction: view.scale > 1 ? "none" : undefined,
        cursor: view.scale > 1 ? "grab" : undefined,
      }}
    >
      <div
        data-testid="occlusion-frame"
        aria-hidden="true"
        className="absolute"
        style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, background: "var(--paper)" }}
      >
        {props.imageUrl && (
          <img
            src={props.imageUrl}
            alt=""
            draggable={false}
            decoding="async"
            className="absolute top-0 left-0 size-full"
            style={{ opacity: image.natural ? 1 : 0 }}
            onLoad={image.onLoad}
            onError={image.onError}
          />
        )}
        <OcclusionMasks placed={placed} frameHeight={frame.h} />
      </div>
      {image.failed && (
        <p className="absolute inset-0 m-0 grid place-items-center p-4 text-center text-[13px] text-ink-3">
          {t("Flashcards", "StudyOcclusionImageFailed")}
        </p>
      )}
    </div>
  )
}
