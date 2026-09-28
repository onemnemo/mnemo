import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { useShortcutChord } from "@/keybinds/store"

import { ZOOM_STEP } from "../canvas/camera"
import { FloatBar, Sep, Slot } from "./bits"

export interface MindmapZoomBarProps {
  /** The live camera scale, for the readout. Settled rather than per frame. */
  zoom: number
  onZoomBy: (factor: number) => void
  onZoomReset: () => void
  onFit: () => void
}

/** Zoom out, the readout that resets it, zoom in, and fit, in the pane's bottom-right corner. */
export function MindmapZoomBar({ zoom, onZoomBy, onZoomReset, onFit }: MindmapZoomBarProps) {
  const t = useT()
  const fitChord = useShortcutChord("mindmap.recenter")

  return (
    <FloatBar role="toolbar" aria-label={t("Mindmap", "ZoomBarLabel")}>
      <Slot label={t("Mindmap", "ZoomOut")} onClick={() => onZoomBy(1 / ZOOM_STEP)}>
        <AppIcon name="minus" size={15} strokeWidth={1.7} />
      </Slot>
      <Slot label={t("Mindmap", "ResetZoom")} onClick={onZoomReset} wide>
        {`${Math.round(zoom * 100)}%`}
      </Slot>
      <Slot label={t("Mindmap", "ZoomIn")} onClick={() => onZoomBy(ZOOM_STEP)}>
        <AppIcon name="plus" size={15} strokeWidth={1.7} />
      </Slot>

      <Sep />

      <Slot label={t("Mindmap", "FitToScreenTooltip")} chord={fitChord} onClick={onFit}>
        <AppIcon name="maximize" size={15} strokeWidth={1.7} />
      </Slot>
    </FloatBar>
  )
}
