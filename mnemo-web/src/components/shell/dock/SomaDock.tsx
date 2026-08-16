import { lazy, Suspense, useCallback, useEffect, useRef } from "react"

import { navigate } from "@/app/router"
import { SomaMark } from "@/chat/components/SomaMark"
import { useChatStore } from "@/chat/store"
import { FrameButton } from "@/components/shell/topbar/FrameButton"
import { useT } from "@/i18n/useT"
import { useShortcutLabel } from "@/keybinds/store"
import { useSettingValue } from "@/settings/store"
import { clampDockWidth, DOCK_MAX_WIDTH, DOCK_MIN_WIDTH, useSomaStore } from "@/stores/soma"

// The dock is frame furniture, so it is mounted on every route. Importing the
// conversation statically here would pull react-markdown into the initial bundle
// no matter how the route imports it: a module is only split when every
// importer is dynamic.
const SomaDockBody = lazy(() =>
  import("@/chat/components/SomaDockBody").then((m) => ({ default: m.SomaDockBody })),
)

/** How far one arrow press moves the edge. Coarse enough to cross the range without holding it. */
const KEYBOARD_STEP = 16

/**
 * Soma, beside the work instead of instead of it.
 *
 * The rail can navigate to Soma, but navigating away from what you are doing to
 * ask about it defeats the point. The dock is frame furniture for that reason: it
 * lives beside the canvas and survives navigation.
 *
 * It pushes the canvas rather than floating over it. You leave this open for minutes at a
 * time while you read and take notes, and a panel that covers what you are asking about
 * is only tolerable for the few seconds a popover lives.
 *
 * The assistant toggle hides it outright rather than disabling it, the same way it
 * hides the rail entry, so an install with the assistant off has no trace of it.
 */
export function SomaDock() {
  const t = useT()
  const enabled = useSettingValue("AI.EnableAssistant", false)
  const open = useSomaStore((s) => s.dockOpen)
  const width = useSomaStore((s) => s.dockWidth)
  const setDockWidth = useSomaStore((s) => s.setDockWidth)
  const newChat = useChatStore((s) => s.newChat)
  const shortcut = useShortcutLabel("global.assistant")

  const endDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endDrag.current?.(), [])

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const move = (ev: PointerEvent) => setDockWidth(window.innerWidth - ev.clientX)
      const stop = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", stop)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
        endDrag.current = null
      }
      // The cursor is set on the body, not the strip: once the pointer leaves the 7px
      // target mid-drag the strip's own cursor stops applying and the arrow flickers back.
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", stop)
      endDrag.current = stop
    },
    [setDockWidth],
  )

  const onSeparatorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") setDockWidth(width + KEYBOARD_STEP)
    else if (e.key === "ArrowRight") setDockWidth(width - KEYBOARD_STEP)
    else return
    e.preventDefault()
  }

  const close = () => useSomaStore.getState().setDockOpen(false)

  // Soma is one conversation wherever you are reading it, so the full surface picks up
  // exactly what the dock was showing and the dock gets out of the way.
  const openFull = () => {
    close()
    navigate("soma")
  }

  if (!enabled || !open) return null

  return (
    <aside
      aria-label="Soma"
      style={{ width: clampDockWidth(width) }}
      className="relative flex shrink-0 flex-col border-l border-line-soft bg-canvas"
    >
      {/* A 7px target straddling the 1px seam. The seam is the thing you aim at, and a
          border you can only hit dead on is a border you miss. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Chat", "ResizeDock")}
        aria-valuenow={width}
        aria-valuemin={DOCK_MIN_WIDTH}
        aria-valuemax={DOCK_MAX_WIDTH}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={onSeparatorKeyDown}
        className="absolute top-0 -left-[3px] z-10 h-full w-[7px] cursor-col-resize outline-none"
      />

      <div className="flex h-11 shrink-0 items-center gap-2 pr-1.5 pl-3">
        <SomaMark size={18} />
        <span className="flex-1 truncate text-[13px] font-medium text-ink">Soma</span>
        <FrameButton icon="common/plus" label={t("Chat", "NewChat")} onClick={newChat} className="size-7" />
        <FrameButton icon="maximize" label={t("Chat", "OpenFullSoma")} onClick={openFull} className="size-7" />
        <FrameButton
          icon="x"
          label={t("Common", "Close")}
          hint={shortcut ? `${t("Common", "Close")} · ${shortcut}` : undefined}
          onClick={close}
          className="size-7"
        />
      </div>

      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <SomaDockBody />
      </Suspense>
    </aside>
  )
}
