import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { isEditableTarget } from "@/keybinds/chord"
import { useShortcutChord } from "@/keybinds/store"
import { cn } from "@/lib/utils"

import { ZOOM_STEP } from "../canvas/camera"
import type { CanvasRuntime } from "../canvas/runtime"
import type { Scene, Viewport } from "../model/scene"
import { MindmapMinimap, type MinimapSink } from "./Minimap"
import { BarButton, BarDivider } from "./panel/BarButton"
import type { Held } from "./useBarAnchor"
import { useMinimapAuto } from "./useMinimapAuto"
import { NEXT_MODE, useMinimapShown, type MinimapMode } from "./useMinimapShown"
import { ZoomMenu } from "./ZoomMenu"

/**
 * The strip, and the strip with the map card over it. The zoom menu is left to overlap rather than
 * growing the box, which would move a toolbar docked on the right.
 */
const STRIP = 40
const WITH_CARD = STRIP + 6 + 132

export interface MindmapViewDockProps {
  /** The live camera scale, for the readout. Settled rather than per frame. */
  zoom: number
  onZoomBy: (factor: number) => void
  onZoomReset: () => void
  onFit: () => void
  scene: Scene
  runtime: Held<CanvasRuntime>
  pane: Held<HTMLElement>
  /** Where the canvas hands every camera change. The dock feeds the minimap and the Auto rule from it. */
  sink: MinimapSink
  selected: ReadonlySet<string>
  /** The dock's box, which a docked toolbar keeps clear of. */
  ref?: Ref<HTMLDivElement>
}

/** The bottom-right corner: the minimap card over a strip of view controls, and the zoom menu. */
export function MindmapViewDock({
  zoom,
  onZoomBy,
  onZoomReset,
  onFit,
  scene,
  runtime,
  pane,
  sink,
  selected,
  ref,
}: MindmapViewDockProps) {
  const t = useT()
  const fitChord = useShortcutChord("mindmap.recenter")
  // While the view is dragged on the minimap, Auto waits: the drag can bring the whole map into view,
  // and the card must not leave from under the pointer holding it.
  const held = useRef(false)
  const { offScreen, onCamera: checkAuto } = useMinimapAuto(scene, runtime, pane, held)
  const { mode, shown: wanted, setMode } = useMinimapShown(offScreen)
  const [menu, setMenu] = useState(false)
  const shown = wanted && !menu
  const repaint = useRef<MinimapSink["current"]>(null)
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLButtonElement>(null)

  // Placed without motion until the camera has first settled, so a map that opens zoomed in does not
  // show the card rising in.
  const [settled, setSettled] = useState(false)
  const heard = useRef(false)

  const checkCamera = useCallback(
    (viewport: Viewport) => {
      const host = pane.current
      if (host && !held.current) {
        checkAuto(viewport, { width: host.clientWidth, height: host.clientHeight })
      }
    },
    [pane, checkAuto],
  )

  useLayoutEffect(() => {
    let frame = 0
    const onCamera: NonNullable<MinimapSink["current"]> = (viewport) => {
      repaint.current?.(viewport)
      checkCamera(viewport)
      if (!heard.current) {
        heard.current = true
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => setSettled(true))
        })
      }
    }
    sink.current = onCamera
    return () => {
      cancelAnimationFrame(frame)
      if (sink.current === onCamera) {
        sink.current = null
      }
    }
  }, [sink, checkCamera])

  const hold = useCallback(
    (on: boolean) => {
      held.current = on
      const viewport = on ? null : runtime.current?.viewport()
      if (viewport) {
        checkCamera(viewport)
      }
    },
    [runtime, checkCamera],
  )

  useEffect(() => {
    if (!menu) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setMenu(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isEditableTarget(event.target)) {
        return
      }
      // Taken before the canvas hears it, which would otherwise clear the selection, and before an open
      // selection panel's own window listener, so one Escape closes one thing.
      event.stopImmediatePropagation()
      setMenu(false)
    }
    window.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [menu])

  // Opened from the keyboard, the focus moves into the menu; closed with it inside, it comes back to
  // the readout rather than being stranded in an inert panel.
  useLayoutEffect(() => {
    const button = readout.current
    if (menu && button && document.activeElement === button && button.matches(":focus-visible")) {
      panel.current?.querySelector<HTMLElement>("button")?.focus()
    } else if (!menu && panel.current?.contains(document.activeElement)) {
      button?.focus()
    }
  }, [menu])

  const choose = (action: () => void) => () => {
    action()
    setMenu(false)
  }

  const next = NEXT_MODE[mode]
  const motion = settled ? "opacity var(--duration-slow) ease, transform var(--duration-card) var(--ease-settle)" : "none"

  return (
    <div
      ref={(node) => {
        root.current = node
        if (typeof ref === "function") {
          ref(node)
        } else if (ref) {
          ref.current = node
        }
      }}
      className="pointer-events-none absolute right-4 bottom-4 z-40 w-[212px]"
      style={{ height: mode === "Off" ? STRIP : WITH_CARD }}
    >
      <div
        aria-hidden={!shown}
        inert={!shown}
        className={cn(
          "absolute bottom-[46px] left-0 h-[132px] w-[212px] origin-bottom rounded-[13px] bg-surface-float p-1 shadow-float",
          shown ? "pointer-events-auto" : "pointer-events-none",
        )}
        style={{
          opacity: shown ? 1 : 0,
          transform: shown ? "none" : "translateY(10px) scale(0.96)",
          transition: motion,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="relative size-full overflow-hidden rounded-[9px] bg-canvas-sunken">
          <MindmapMinimap
            scene={scene}
            runtime={runtime}
            pane={pane}
            sink={repaint}
            selected={selected}
            visible={shown}
            onHold={hold}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[9px] shadow-[inset_0_0_0_1px_var(--line-soft)]"
          />
        </div>
      </div>

      <ZoomMenu
        ref={panel}
        open={menu}
        onZoomIn={choose(() => onZoomBy(ZOOM_STEP))}
        onZoomOut={choose(() => onZoomBy(1 / ZOOM_STEP))}
        onZoomReset={choose(onZoomReset)}
        onFit={choose(onFit)}
        mode={mode}
        onMode={setMode}
      />

      <div
        role="group"
        aria-label={t("Mindmap", "ZoomBarLabel")}
        className="pointer-events-auto absolute bottom-0 left-0 flex h-10 w-[212px] items-center gap-0.5 rounded-[13px] bg-surface-float p-1 shadow-float"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <MapButton mode={mode} next={next} onClick={() => setMode(next)} />
        <Divider />
        <BarButton label={t("Mindmap", "ZoomOut")} onClick={() => onZoomBy(1 / ZOOM_STEP)} className="w-8 justify-center">
          <AppIcon name="minus" size={16} strokeWidth={1.8} />
        </BarButton>
        <BarButton
          ref={readout}
          label={t("Mindmap", "Zoom")}
          opens={{ key: "zoom", open: menu }}
          onClick={() => setMenu((open) => !open)}
          className="w-[54px] justify-center gap-0.5 pl-1 text-[12px] font-medium text-ink tabular-nums"
        >
          {`${Math.round(zoom * 100)}%`}
          <span
            className="grid text-ink-3"
            style={{
              transform: menu ? "rotate(180deg)" : "none",
              transition: "transform var(--duration-turn) var(--ease-settle)",
            }}
          >
            <AppIcon name="chevron-up" size={11} strokeWidth={2.4} />
          </span>
        </BarButton>
        <BarButton label={t("Mindmap", "ZoomIn")} onClick={() => onZoomBy(ZOOM_STEP)} className="w-8 justify-center">
          <AppIcon name="plus" size={16} strokeWidth={1.8} />
        </BarButton>
        <Divider />
        <BarButton label={t("Mindmap", "FitToScreenTooltip")} chord={fitChord} onClick={onFit} className="w-8 justify-center">
          <AppIcon name="maximize" size={16} strokeWidth={1.8} />
        </BarButton>
      </div>
    </div>
  )
}

/** On, Auto or Off, one press to the next. On is pressed, Auto wears a badge, Off is struck through. */
function MapButton({ mode, next, onClick }: { mode: MinimapMode; next: MinimapMode; onClick: () => void }) {
  const t = useT()
  const auto = mode === "Auto"
  return (
    <BarButton
      label={t("Mindmap", "MinimapState").replace("{0}", t("Mindmap", `Minimap${mode}`))}
      detail={t("Mindmap", "MinimapNext").replace("{0}", t("Mindmap", `Minimap${next}`))}
      side="left"
      onClick={onClick}
      className={cn(
        "relative w-8 justify-center",
        mode === "On" && "bg-frame-active text-ink",
        auto && "text-ink",
        mode === "Off" && "text-ink-3 hover:text-ink-3",
      )}
    >
      <span className="relative grid size-4 place-items-center">
        <AppIcon name="map" size={16} strokeWidth={1.8} />
        {mode === "Off" ? (
          <svg aria-hidden viewBox="0 0 24 24" className="absolute inset-0 size-4">
            <path d="M3 3l18 18" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
          </svg>
        ) : null}
      </span>
      <span
        aria-hidden
        className="absolute right-0.5 bottom-0.5 grid size-3 place-items-center rounded-[4px] bg-solid text-[8.5px] font-bold text-solid-fg"
        style={{
          boxShadow: "0 0 0 1.5px var(--surface-float)",
          opacity: auto ? 1 : 0,
          transform: auto ? "none" : "scale(0.4)",
          transition: "opacity var(--duration-press) ease, transform var(--duration-turn) var(--ease-spring)",
        }}
      >
        {t("Mindmap", "MinimapAuto").charAt(0)}
      </span>
    </BarButton>
  )
}

function Divider() {
  return <BarDivider className="mx-0.5" />
}
