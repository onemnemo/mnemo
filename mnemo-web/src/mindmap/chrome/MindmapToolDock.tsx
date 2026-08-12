import { useEffect, useMemo, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { useShortcutChord } from "@/keybinds/store"

import type { ShapeType } from "../model/document"
import { TOOL_ACTIONS, type MindmapTool } from "../interaction/tool"
import { FloatBar, Sep, Slot } from "./bits"
import { ConnectFlyout, type ConnectStyle } from "./ConnectFlyout"
import { createHold } from "./hold"
import { ShapeFlyout } from "./ShapeFlyout"

interface ToolEntry {
  readonly tool: MindmapTool
  readonly icon: string
  readonly key: string
}

const TOOLS: readonly ToolEntry[] = [
  { tool: "select", icon: "mouse-pointer-2", key: "ToolSelect" },
  { tool: "node", icon: "plus", key: "ToolNode" },
  { tool: "shape", icon: "square", key: "ToolShape" },
  { tool: "text", icon: "type", key: "ToolText" },
  { tool: "connect", icon: "spline", key: "ToolConnect" },
  { tool: "frame", icon: "frame", key: "ToolFrame" },
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
  /** What the shape tool plants, and what the connect tool draws with. */
  shape: ShapeType
  onShape: (shape: ShapeType) => void
  connectStyle: ConnectStyle
  onConnectStyle: (patch: Partial<ConnectStyle>) => void
  /** Opens the file picker. An image is chosen before it is placed, so this arms nothing. */
  onInsertImage: () => void
}

/**
 * The dock: what a press does, and where the camera is.
 *
 * It floats over the canvas rather than taking a row of the layout, so the map is the full height of
 * the pane and the dock is over the part of it nobody puts anything in. The wrapper is
 * pointer-events-none and only the bar itself takes presses, or the invisible full-width row it is
 * centred in would swallow every click along the bottom of the map.
 *
 * Two of the tools own a set of sub-choices, and those open on a hold rather than as separate
 * controls on the bar. Putting every choice on the bar is how a toolbar ends up as wide as the
 * feature list, and putting them behind a second panel is how nobody finds them.
 */
export function MindmapToolDock({
  tool,
  onTool,
  zoom,
  onZoomBy,
  onZoomReset,
  onFit,
  shape,
  onShape,
  connectStyle,
  onConnectStyle,
  onInsertImage,
}: MindmapToolDockProps) {
  const t = useT()
  const [open, setOpen] = useState<MindmapTool | null>(null)
  const fitChord = useShortcutChord("mindmap.recenter")
  const imageChord = useShortcutChord("mindmap.new-image")

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center">
      <FloatBar>
        {TOOLS.map((entry) => {
          const active = tool === entry.tool
          const holds = entry.tool === "shape" || entry.tool === "connect"

          return (
            <div key={entry.tool} className="relative">
              <ToolSlot
                label={t("Mindmap", entry.key)}
                action={TOOL_ACTIONS[entry.tool]}
                icon={entry.icon}
                active={active}
                onTap={() => onTool(entry.tool)}
                // A hold arms the tool as well as opening its choices, since nobody holds a tool
                // they were not about to use.
                onHold={
                  holds
                    ? () => {
                        onTool(entry.tool)
                        setOpen(entry.tool)
                      }
                    : undefined
                }
              />

              {open === "shape" && entry.tool === "shape" ? (
                <ShapeFlyout shape={shape} onShape={onShape} onClose={() => setOpen(null)} />
              ) : null}
              {open === "connect" && entry.tool === "connect" ? (
                <ConnectFlyout
                  style={connectStyle}
                  onStyle={onConnectStyle}
                  onClose={() => setOpen(null)}
                />
              ) : null}
            </div>
          )
        })}

        {/* Beside the tools rather than among them, because it is not one: a picture has to be
            chosen before it can be placed, so the press opens a picker instead of arming the
            canvas for the next click. */}
        <Slot label={t("Mindmap", "ToolImage")} chord={imageChord} onClick={onInsertImage}>
          <AppIcon name="common/image" size={15} strokeWidth={1.7} />
        </Slot>

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

        <Slot label={t("Mindmap", "FitToScreenTooltip")} chord={fitChord} onClick={onFit}>
          <AppIcon name="maximize" size={15} strokeWidth={1.7} />
        </Slot>
      </FloatBar>
    </div>
  )
}

/**
 * One tool, which is a click for the tool itself and, where it has them, a hold for its choices.
 *
 * The gesture is rebuilt whenever its callbacks change and torn down with the slot, so a press left
 * mid-flight by a rerender cannot fire its timer into a callback nobody is listening to any more.
 */
function ToolSlot({
  label,
  action,
  icon,
  active,
  onTap,
  onHold,
}: {
  label: string
  /** The keybind action the tool is armed by. Its chord is whatever the catalog currently says. */
  action: string
  icon: string
  active: boolean
  onTap: () => void
  onHold?: () => void
}) {
  const chord = useShortcutChord(action)
  const hold = useMemo(() => createHold({ onTap, onHold: onHold ?? onTap }), [onTap, onHold])
  useEffect(() => hold.cancel, [hold])

  return (
    <Slot
      label={label}
      chord={chord}
      active={active}
      onPointerDown={hold.onPointerDown}
      onPointerUp={hold.onPointerUp}
      onPointerLeave={hold.onPointerLeave}
      onPointerCancel={hold.onPointerCancel}
    >
      {/* A heavier stroke on the armed tool, so it reads as active even where the accent fill is
          hard to tell from a hover wash. */}
      <AppIcon name={icon} size={15} strokeWidth={active ? 2 : 1.7} />
    </Slot>
  )
}
