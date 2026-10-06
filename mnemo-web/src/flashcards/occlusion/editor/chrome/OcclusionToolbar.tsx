import { useLayoutEffect, useMemo, useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { barLayout, BAR_PADDING, BAR_THICKNESS, type BarItem } from "@/mindmap/chrome/toolbar/placement"
import { Divider, ToolChip } from "@/mindmap/chrome/toolbar/ToolbarParts"
import { ToolbarSlot } from "@/mindmap/chrome/toolbar/ToolbarSlot"
import { createRovingFocus } from "@/notes/editor/floating/roving-focus"

import type { EditorAction } from "../keys"
import type { Tool } from "../state"
import type { ActionChords } from "./useActionChords"

interface ToolSpec {
  tool: Tool
  action: EditorAction
  icon: string
  key: string
}

const SELECTING: readonly ToolSpec[] = [
  { tool: "select", action: "tool-select", icon: "mouse-pointer-2", key: "OcclusionToolSelect" },
  { tool: "pan", action: "tool-pan", icon: "hand", key: "OcclusionToolPan" },
]
const DRAWING: readonly ToolSpec[] = [
  { tool: "rect", action: "tool-rect", icon: "square", key: "OcclusionToolRect" },
  { tool: "ellipse", action: "tool-ellipse", icon: "circle", key: "OcclusionToolEllipse" },
  { tool: "polygon", action: "tool-polygon", icon: "pentagon", key: "OcclusionToolPolygon" },
]

const ITEMS: readonly BarItem[] = [
  ...SELECTING.map((spec): BarItem => ({ kind: "tool", id: spec.tool })),
  { kind: "sep" },
  ...DRAWING.map((spec): BarItem => ({ kind: "tool", id: spec.tool })),
]
const LAYOUT = barLayout(ITEMS, null)

/** The drawing tools on the mind map's bar pieces: a row with the armed tool's chip sliding under it. */
export function OcclusionToolbar({
  tool,
  onTool,
  chords,
  compact,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  chords: ActionChords
  /** Docks bottom left instead of bottom centre, clear of the view controls. */
  compact: boolean
}) {
  const t = useT()
  const row = useRef<HTMLDivElement>(null)
  const roving = useMemo(
    () => createRovingFocus(() => [[...(row.current?.querySelectorAll<HTMLButtonElement>("[data-tb-tool]") ?? [])]]),
    [],
  )
  useLayoutEffect(() => roving.sync())

  const chipIndex = ITEMS.findIndex((item) => item.kind === "tool" && item.id === tool)
  const slot = (spec: ToolSpec) => (
    <ToolbarSlot
      key={spec.tool}
      id={spec.tool}
      label={t("Flashcards", spec.key)}
      chord={chords.chord(spec.action)}
      tip="top"
      armed={tool === spec.tool}
      vertical={false}
      onPress={() => onTool(spec.tool)}
    >
      <AppIcon name={spec.icon} size={18} strokeWidth={1.7} />
    </ToolbarSlot>
  )

  return (
    <div
      className="pointer-events-none absolute bottom-4 z-40"
      style={compact ? { left: 16 } : { left: "50%", transform: "translateX(-50%)" }}
    >
      <div
        ref={row}
        role="toolbar"
        aria-label={t("Flashcards", "OcclusionToolsLabel")}
        className="pointer-events-auto relative flex rounded-2xl bg-surface-float p-1.5 shadow-float"
        style={{ width: LAYOUT.length, height: BAR_THICKNESS }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).dataset.tbTool !== undefined && roving.handleKey(event.nativeEvent)) {
            event.preventDefault()
          }
        }}
      >
        {/* The same one pixel inset as the mind map toolbar's chip. */}
        <ToolChip at={chipIndex >= 0 ? LAYOUT.offsets[chipIndex] + 1 : BAR_PADDING} vertical={false} shown={chipIndex >= 0} eased />
        {SELECTING.map(slot)}
        <Divider vertical={false} />
        {DRAWING.map(slot)}
      </div>
    </div>
  )
}
