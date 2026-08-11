import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { TOOL_KEY_OF, type MindmapTool } from "../interaction/tool"
import { FloatBar, Sep, Slot } from "./bits"

interface ToolEntry {
  readonly tool: MindmapTool
  readonly icon: string
  readonly key: string
}

const TOOLS: readonly ToolEntry[] = [
  { tool: "select", icon: "mouse-pointer-2", key: "ToolSelect" },
  { tool: "node", icon: "plus", key: "ToolNode" },
  { tool: "text", icon: "type", key: "ToolText" },
  { tool: "connect", icon: "spline", key: "ToolConnect" },
]

/** What a zoom button multiplies by. Matches a wheel notch closely enough that the two agree. */
const ZOOM_STEP = 1.25

export interface MindmapToolDockProps {
  tool: MindmapTool
  onTool: (tool: MindmapTool) => void
  /** The live camera scale, for the readout. Settled rather than per frame. */
  zoom: number
  onZoomBy: (factor: number) => void
  onZoomReset: () => void
  onFit: () => void
}

/**
 * The dock: what a press does, and where the camera is.
 *
 * It floats over the canvas rather than taking a row of the layout, so the map is the full height of
 * the pane and the dock is over the part of it nobody puts anything in. The wrapper is
 * pointer-events-none and only the bar itself takes presses, or the invisible full-width row it is
 * centred in would swallow every click along the bottom of the map.
 */
export function MindmapToolDock({
  tool,
  onTool,
  zoom,
  onZoomBy,
  onZoomReset,
  onFit,
}: MindmapToolDockProps) {
  const t = useT()
  const hint = (label: string, key: string): string =>
    t("Mindmap", "ShortcutHintFormat").replace("{0}", label).replace("{1}", key)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center">
      <FloatBar>
        {TOOLS.map((entry) => {
          const active = tool === entry.tool
          return (
            <Slot
              key={entry.tool}
              label={hint(t("Mindmap", entry.key), TOOL_KEY_OF[entry.tool])}
              active={active}
              onClick={() => onTool(entry.tool)}
            >
              {/* A heavier stroke on the armed tool, so it reads as active even where the accent
                  fill is hard to tell from a hover wash. */}
              <AppIcon name={entry.icon} size={15} strokeWidth={active ? 2 : 1.7} />
            </Slot>
          )
        })}

        <Sep />

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

        <Slot label={t("Mindmap", "FitToScreenTooltip")} onClick={onFit}>
          <AppIcon name="maximize" size={15} strokeWidth={1.7} />
        </Slot>
      </FloatBar>
    </div>
  )
}
