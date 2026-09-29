import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"

import type { TooltipSide } from "@/components/ui/tooltip/placement"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { createRovingFocus } from "@/notes/editor/floating/roving-focus"

import type { MindmapTool } from "../../interaction/tool"
import type { Point } from "../../model/scene"
import { focusCanvas } from "../../page/route-guards"
import { bindGroup, type GroupBinding, type ToolChoices, type ToolChoiceSetters } from "./binding"
import { GROUPS, groupOfTool, TOOLBAR, type GroupId, type ToolEntry } from "./groups"
import {
  barLayout,
  barSize,
  BAR_PADDING,
  BAR_THICKNESS,
  dockOrigin,
  GRIP_LENGTH,
  isVertical,
  placementOf,
  shelfPosition,
  shelfSize,
  shelfTravel,
  TOOL_STEP,
  type BarItem,
  type DockEdge,
  type Size,
} from "./placement"
import { ToolbarDropZones } from "./ToolbarDropZones"
import { Divider, Grip, ToolButtonWithTray } from "./ToolbarParts"
import { ToolbarShelf } from "./ToolbarShelf"
import { useGroupKeys } from "./useGroupKeys"
import { useToolbarDock } from "./useToolbarDock"

/** What the map's keyboard asks of the bar. */
export interface ToolbarCommands {
  /** Exactly what a click on the tool does, so a tool's key opens its group the way a click does. */
  press(id: ToolEntry["id"]): void
  /** Moves the focus onto the bar, for F6. */
  focus(): void
}

export interface MindmapToolbarProps extends ToolChoices, ToolChoiceSetters {
  readonly tool: MindmapTool
  readonly onTool: (tool: MindmapTool) => void
  /** The pane the bar floats over and docks to the edges of. */
  readonly stage: RefObject<HTMLElement | null>
  /** The chrome in the pane's bottom-right corner, which the bar keeps clear of. */
  readonly corner: RefObject<HTMLElement | null>
  /** The edge the person last docked to. */
  readonly edge: DockEdge
  readonly onEdge: (edge: DockEdge) => void
  /** Told the edge the bar actually sits on, which is the bottom when the stored one has no room. */
  readonly onDocked?: (edge: DockEdge) => void
  /** While something else owns the keyboard, the radial ring for one, an open group's keys stand down. */
  readonly keysSuspended?: boolean
  readonly commands?: RefObject<ToolbarCommands | null>
}

const TIP_SIDE: Record<DockEdge, TooltipSide> = { bottom: "top", top: "bottom", left: "right", right: "left" }

/** The grip's centre from the bar's corner, which is where the carried bar hangs from the pointer. */
const GRIP_CENTER = BAR_PADDING + GRIP_LENGTH / 2

const ITEMS: readonly BarItem[] = [
  { kind: "grip" },
  ...TOOLBAR.flatMap((entry): BarItem[] => {
    if (entry === "sep") {
      return [{ kind: "sep" }]
    }
    const tool: BarItem = { kind: "tool", id: entry.id }
    const group = entry.group ? GROUPS[entry.group] : null
    return group && placementOf(group) === "inline"
      ? [tool, { kind: "tray", group: group.id, count: group.options.length }]
      : [tool]
  }),
]

const RESTING_LENGTH = barLayout(ITEMS, null).length

/** Where a shelf goes when its place beside the bar would run off the pane: back inside it. */
function keepInside(at: Point, shelf: Size, pane: Size): Point {
  if (pane.width === 0) {
    return at
  }
  const clamp = (value: number, room: number, length: number) =>
    Math.max(SHELF_MARGIN, Math.min(value, room - length - SHELF_MARGIN))
  return { x: clamp(at.x, pane.width, shelf.width), y: clamp(at.y, pane.height, shelf.height) }
}

const SHELF_MARGIN = 8

/**
 * The map editor's tools, on a bar that docks to any edge of the pane. A tool that owns a group opens
 * it inside the bar when the group is small, on a shelf beside it when it is not.
 */
export function MindmapToolbar(props: MindmapToolbarProps) {
  const { tool, onTool, stage, corner, edge: stored, onEdge, onDocked, keysSuspended, commands } = props
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  const tools = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<GroupId | null>(null)

  // Sync during render, so a tool armed from the keyboard or the ring never paints its predecessor's group.
  const [seenTool, setSeenTool] = useState(tool)
  if (seenTool !== tool) {
    setSeenTool(tool)
    if (open && groupOfTool(tool)?.id !== open) {
      setOpen(null)
    }
  }

  const dock = useToolbarDock({ stage, corner, stored, onStore: onEdge, length: RESTING_LENGTH })
  const edge = dock.drag?.target ?? dock.edge
  const vertical = isVertical(edge)
  const tip = dock.drag ? null : TIP_SIDE[edge]

  const openGroup = open ? GROUPS[open] : null
  const layout = barLayout(ITEMS, openGroup && placementOf(openGroup) === "inline" ? openGroup.id : null)
  const size = barSize(edge, layout.length)
  const origin: Point = dock.drag
    ? vertical
      ? { x: dock.drag.point.x - BAR_THICKNESS / 2, y: dock.drag.point.y - GRIP_CENTER }
      : { x: dock.drag.point.x - GRIP_CENTER, y: dock.drag.point.y - BAR_THICKNESS / 2 }
    : dockOrigin(dock.edge, dock.pane, size, dock.reserve)

  const { selectMode, shape, nodeStyle, connector, onSelectMode, onShape, onNodeStyle, onConnector } = props
  const bindings = useMemo(() => {
    const choices = { selectMode, shape, nodeStyle, connector }
    const setters = { onSelectMode, onShape, onNodeStyle, onConnector }
    return {
      select: bindGroup("select", choices, setters),
      node: bindGroup("node", choices, setters),
      shape: bindGroup("shape", choices, setters),
      connect: bindGroup("connect", choices, setters),
    } satisfies Record<GroupId, GroupBinding>
  }, [selectMode, shape, nodeStyle, connector, onSelectMode, onShape, onNodeStyle, onConnector])

  const closeGroup = () => setOpen(null)

  // Focus stranded in a group that closed, which is inert by then, goes to the armed tool rather than
  // falling to the page, where the map hears none of its keys. The last focus seen covers a browser
  // that has already dropped it.
  const lastFocus = useRef<Element | null>(null)
  const shown = useRef(open)
  useLayoutEffect(() => {
    const closed = shown.current
    shown.current = open
    if (!closed || closed === open) {
      return
    }
    const active = document.activeElement
    const stranded = (element: Element | null | undefined) =>
      !!element && !!root.current?.contains(element) && element.closest("[inert]") !== null
    if (stranded(active) || (active === document.body && stranded(lastFocus.current))) {
      tools.current?.querySelector<HTMLButtonElement>('[data-tb-tool][aria-pressed="true"]')?.focus()
    }
  }, [open])

  useGroupKeys(openGroup, open ? bindings[open] : null, closeGroup, stage, keysSuspended === true)

  useEffect(() => {
    onDocked?.(dock.edge)
  }, [dock.edge, onDocked])

  // A press anywhere outside the toolbar puts an open group away: the canvas, the header, a menu.
  useEffect(() => {
    if (!open) {
      return
    }
    const onPress = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(null)
      }
    }
    document.addEventListener("pointerdown", onPress, true)
    return () => document.removeEventListener("pointerdown", onPress, true)
  }, [open])

  // A vertical bar is one control per row, so its up and down keys are the ones that walk it.
  const axis = useRef(vertical)
  const roving = useMemo(
    () =>
      createRovingFocus(() => {
        const buttons = [...(tools.current?.querySelectorAll<HTMLButtonElement>("[data-tb-tool]") ?? [])]
        return axis.current ? buttons.map((button) => [button]) : [buttons]
      }),
    [],
  )
  useLayoutEffect(() => {
    axis.current = vertical
    roving.sync()
  })

  const press = (entry: ToolEntry) => {
    const group = entry.group ?? null
    if (group && tool === entry.id) {
      setOpen(open === group ? null : group)
      return
    }
    onTool(entry.id)
    // Select is the tool everyone returns to, so arming it never opens its tray; pressing it again does.
    setOpen(group === "select" ? null : group)
  }

  useImperativeHandle(commands, () => ({
    press: (id) => {
      const entry = TOOLBAR.find((item) => item !== "sep" && item.id === id)
      if (entry && entry !== "sep") {
        press(entry)
      }
    },
    focus: () => void roving.focus(),
  }))

  // After the bar in the document, so Tab from an opened tool lands in its shelf.
  const shelves = (Object.keys(GROUPS) as GroupId[])
    .filter((id) => placementOf(GROUPS[id]) === "shelf")
    .map((id) => {
      const group = GROUPS[id]
      const index = ITEMS.findIndex((item) => item.kind === "tool" && item.id === id)
      const shelf = shelfSize(group.options.length)
      const offset = shelfPosition(edge, size, layout.offsets[index] + TOOL_STEP / 2, shelf)
      return (
        <ToolbarShelf
          key={id}
          group={group}
          binding={bindings[id]}
          open={open === id && !dock.drag}
          at={keepInside({ x: origin.x + offset.x, y: origin.y + offset.y }, shelf, dock.pane)}
          travel={shelfTravel(edge)}
        />
      )
    })

  const chipIndex = ITEMS.findIndex((item) => item.kind === "tool" && item.id === tool)
  const chipAt = chipIndex >= 0 ? layout.offsets[chipIndex] + 1 : BAR_PADDING

  return (
    // Clipped to the pane, so a bar carried past its edge never gives the page a scrollbar to flash.
    <div
      ref={root}
      data-mm-toolbar=""
      className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
      onFocus={(event) => {
        lastFocus.current = event.target
      }}
      // An open group has already taken its Escape, so one reaching here leaves the bar for the map.
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault()
          focusCanvas(stage.current)
        }
      }}
    >
      {dock.drag ? (
        <ToolbarDropZones
          target={dock.drag.target}
          spots={dock.allowed.map((spot) => {
            const spotSize = barSize(spot, RESTING_LENGTH)
            return { edge: spot, size: spotSize, at: dockOrigin(spot, dock.pane, spotSize, dock.reserve) }
          })}
        />
      ) : null}

      <div
        ref={tools}
        role="toolbar"
        aria-label={t("Mindmap", "ToolbarLabel")}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        className={cn(
          "pointer-events-auto absolute flex rounded-2xl bg-surface-float p-1.5",
          vertical ? "flex-col" : "flex-row",
          dock.drag ? "shadow-lift" : "shadow-float",
        )}
        style={{
          left: origin.x,
          top: origin.y,
          width: size.width,
          height: size.height,
          // Until the pane has been measured there is nowhere to dock to.
          visibility: dock.pane.width > 0 ? undefined : "hidden",
          transform: dock.drag ? "scale(1.03) rotate(-1.2deg)" : "none",
          // The size keeps easing while the bar is carried, so crossing into a side edge morphs it from
          // a row into a column. Nothing eases before the first placement, so a bar docked on a side
          // does not turn into place from the unmeasured default.
          transition: dock.settling
            ? [
                "transform var(--duration-lift) var(--ease-settle)",
                "box-shadow var(--duration-conceal) ease",
                "width var(--duration-tray) var(--ease-settle)",
                "height var(--duration-tray) var(--ease-settle)",
                ...(dock.drag
                  ? []
                  : ["left var(--duration-dock) var(--ease-settle)", "top var(--duration-dock) var(--ease-settle)"]),
              ].join(", ")
            : "none",
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).dataset.tbTool !== undefined && roving.handleKey(event.nativeEvent)) {
            event.preventDefault()
          }
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-9 rounded-[10px] bg-solid shadow-chip"
          style={{
            left: vertical ? BAR_PADDING : chipAt,
            top: vertical ? chipAt : BAR_PADDING,
            opacity: chipIndex >= 0 ? 1 : 0,
            transition: dock.settling
              ? "left var(--duration-chip) var(--ease-spring), top var(--duration-chip) var(--ease-spring), opacity var(--duration-normal) ease"
              : "none",
          }}
        />

        <Grip
          vertical={vertical}
          lifted={dock.drag !== null}
          label={t("Mindmap", "ToolbarMove")}
          hint={tip ? t("Mindmap", "ToolbarDragHint") : ""}
          side={tip}
          onPointerDown={dock.onGripPointerDown}
          onKeyDown={dock.onGripKeyDown}
        />

        {TOOLBAR.map((entry, index) => {
          if (entry === "sep") {
            return <Divider key={`sep${index}`} vertical={vertical} />
          }
          const group = entry.group ? GROUPS[entry.group] : null
          return (
            <ToolButtonWithTray
              key={entry.id}
              entry={entry}
              armed={entry.id === tool}
              open={group !== null && open === group.id}
              binding={entry.group ? bindings[entry.group] : null}
              vertical={vertical}
              tip={tip}
              onPress={() => press(entry)}
            />
          )
        })}
      </div>

      {shelves}
    </div>
  )
}
