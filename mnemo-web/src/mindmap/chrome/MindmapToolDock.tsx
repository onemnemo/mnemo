import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { useShortcutChord } from "@/keybinds/store"

import type { ShapeType } from "../model/document"
import { TOOL_ACTIONS, type MindmapTool } from "../interaction/tool"
import { FloatBar, Sep, Slot } from "./bits"
import { ShapeFlyout } from "./ShapeFlyout"

interface ToolEntry {
  readonly tool: MindmapTool
  readonly icon: string
  readonly key: string
  /** Whether the tool owns a set of sub-choices, which arming it also puts on screen. */
  readonly choices?: boolean
}

const TOOLS: readonly ToolEntry[] = [
  { tool: "select", icon: "mouse-pointer-2", key: "ToolSelect" },
  { tool: "node", icon: "plus", key: "ToolNode" },
  { tool: "shape", icon: "square", key: "ToolShape", choices: true },
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
  /** What the shape tool plants. */
  shape: ShapeType
  onShape: (shape: ShapeType) => void
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
 * The shape tool owns a set of sub-choices, and arming it puts them on screen. A hold would put
 * them behind a gesture with nothing on screen to suggest it, leaving eight shapes behind a press
 * nobody has a reason to try, so the corner mark says the panel is there and an ordinary press
 * opens it.
 *
 * That costs nothing to anyone who did not want it. The panel closes on the next press anywhere
 * outside it, and that press still reaches whatever it landed on, so a press on the map plants the
 * shape and puts the panel away in the same gesture. The keyboard skips it entirely: a tool's own key
 * arms it with what it had last without opening anything.
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
          const opened = open === entry.tool

          return (
            <div key={entry.tool} className="relative">
              <ToolSlot
                label={t("Mindmap", entry.key)}
                action={TOOL_ACTIONS[entry.tool]}
                icon={entry.icon}
                active={tool === entry.tool}
                menu={entry.choices ? { open: opened } : undefined}
                onClick={() => {
                  onTool(entry.tool)
                  // Pressing the tool whose choices are already up puts them away, so the one
                  // control that opened the panel is the one that closes it.
                  setOpen(entry.choices && !opened ? entry.tool : null)
                }}
              />

              {opened && entry.tool === "shape" ? (
                <ShapeFlyout shape={shape} onShape={onShape} onClose={() => setOpen(null)} />
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

/** One tool, and the key that arms it, which the catalog is asked for rather than told. */
function ToolSlot({
  label,
  action,
  icon,
  active,
  menu,
  onClick,
}: {
  label: string
  /** The keybind action the tool is armed by. Its chord is whatever the catalog currently says. */
  action: string
  icon: string
  active: boolean
  menu?: { open: boolean }
  onClick: () => void
}) {
  const chord = useShortcutChord(action)

  return (
    <Slot label={label} chord={chord} active={active} menu={menu} onClick={onClick}>
      {/* A heavier stroke on the armed tool, so it reads as active even where the accent fill is
          hard to tell from a hover wash. */}
      <AppIcon name={icon} size={15} strokeWidth={active ? 2 : 1.7} />
    </Slot>
  )
}
