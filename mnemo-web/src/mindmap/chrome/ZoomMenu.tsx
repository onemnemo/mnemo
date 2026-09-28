import type { ReactNode, Ref } from "react"

import { useT } from "@/i18n/useT"
import { useShortcutLabel } from "@/keybinds/store"
import { cn } from "@/lib/utils"

import { Segmented } from "./panel/Segmented"
import type { MinimapMode } from "./useMinimapShown"

const MODES: readonly MinimapMode[] = ["Off", "Auto", "On"]

export interface ZoomMenuProps {
  open: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFit: () => void
  mode: MinimapMode
  onMode: (mode: MinimapMode) => void
  ref?: Ref<HTMLDivElement>
}

/** The zoom commands and the minimap switch, opened from the percentage in the map card's place. */
export function ZoomMenu({ open, onZoomIn, onZoomOut, onZoomReset, onFit, mode, onMode, ref }: ZoomMenuProps) {
  const t = useT()
  const zoomIn = useShortcutLabel("mindmap.zoom-in")
  const zoomOut = useShortcutLabel("mindmap.zoom-out")
  const fit = useShortcutLabel("mindmap.recenter")

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("Mindmap", "Zoom")}
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "absolute right-0 bottom-[46px] w-max min-w-[212px] origin-bottom rounded-[13px] bg-surface-float p-1.5 shadow-float",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      style={{
        opacity: open ? 1 : 0,
        transform: open ? "none" : "translateY(8px) scale(0.97)",
        transition:
          "opacity var(--duration-normal) ease, transform var(--duration-panel) var(--ease-settle)",
      }}
    >
      <Row label={t("Mindmap", "ZoomIn")} chord={zoomIn} onClick={onZoomIn} />
      <Row label={t("Mindmap", "ZoomOut")} chord={zoomOut} onClick={onZoomOut} />
      <Divider />
      <Row label={t("Mindmap", "ZoomTo100")} onClick={onZoomReset} />
      <Row label={t("Mindmap", "FitToScreenTooltip")} chord={fit} onClick={onFit} />
      <Divider />
      <div className="flex h-8 items-center justify-between gap-3 pr-0.5 pl-2">
        <span className="text-[12.5px] whitespace-nowrap text-ink">{t("Mindmap", "Minimap")}</span>
        <Segmented
          compact
          label={t("Mindmap", "Minimap")}
          value={mode}
          onPick={onMode}
          className="text-[11.5px] font-medium"
          segments={MODES.map((value) => ({
            value,
            label: t("Mindmap", `Minimap${value}`),
            face: t("Mindmap", `Minimap${value}`),
          }))}
        />
      </div>
    </div>
  )
}

function Row({ label, chord, onClick }: { label: string; chord?: string | null; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[30px] w-full items-center gap-2.5 rounded-lg px-2 text-left text-[12.5px] text-ink outline-none",
        "transition-colors duration-(--duration-press) ease-[ease] hover:bg-frame-hover focus-visible:bg-frame-hover",
      )}
    >
      <span className="grow">{label}</span>
      {chord ? <span className="text-[11.5px] text-ink-3 tabular-nums">{chord}</span> : null}
    </button>
  )
}

function Divider() {
  return <div aria-hidden className="mx-1.5 my-[5px] h-px bg-line-soft" />
}
