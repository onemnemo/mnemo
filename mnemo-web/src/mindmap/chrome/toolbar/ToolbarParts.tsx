import { AppIcon } from "@/components/icon/AppIcon"
import { Tooltip } from "@/components/ui/tooltip"
import type { TooltipSide } from "@/components/ui/tooltip/placement"
import { useT } from "@/i18n/useT"
import { useShortcutChord } from "@/keybinds/store"
import { cn } from "@/lib/utils"

import { TOOL_ACTIONS } from "../../interaction/tool"
import type { EdgeRouting, ShapeType } from "../../model/document"
import { RouteGlyph, ShapeGlyph } from "../glyphs"
import type { GroupBinding } from "./binding"
import { GROUPS, type ToolEntry } from "./groups"
import { placementOf } from "./placement"
import { ToolbarInlineTray } from "./ToolbarInlineTray"
import { ToolbarSlot } from "./ToolbarSlot"

export function ToolButtonWithTray({
  entry,
  armed,
  open,
  binding,
  vertical,
  tip,
  onPress,
}: {
  entry: ToolEntry
  armed: boolean
  open: boolean
  binding: GroupBinding | null
  vertical: boolean
  tip: TooltipSide | null
  onPress: () => void
}) {
  const t = useT()
  const chord = useShortcutChord(entry.id === "image" ? "mindmap.new-image" : TOOL_ACTIONS[entry.id])
  const group = entry.group ? GROUPS[entry.group] : null

  return (
    <>
      <ToolbarSlot
        label={t("Mindmap", entry.label)}
        chord={chord}
        tip={tip}
        armed={armed}
        menu={group ? { open } : undefined}
        vertical={vertical}
        onPress={onPress}
      >
        <ToolFace entry={entry} binding={binding} armed={armed} />
      </ToolbarSlot>
      {group && binding && placementOf(group) === "inline" ? (
        <ToolbarInlineTray group={group} binding={binding} open={open} vertical={vertical} tip={tip} />
      ) : null}
    </>
  )
}

/** What a tool shows: its icon, or for Shapes and Connect, the option it will use next. */
function ToolFace({ entry, binding, armed }: { entry: ToolEntry; binding: GroupBinding | null; armed: boolean }) {
  if (entry.group === "select" && binding?.faceId === "lasso") {
    return <AppIcon name="lasso" size={18} strokeWidth={1.7} />
  }
  if (entry.group === "shape" && binding?.faceId) {
    return <ShapeGlyph shape={binding.faceId as ShapeType} width={22} height={16} filled={armed} />
  }
  if (entry.group === "connect" && binding?.faceId) {
    return <RouteGlyph routing={binding.faceId as EdgeRouting} />
  }
  return <AppIcon name={entry.icon ?? "plus"} size={18} strokeWidth={1.7} />
}

export function Grip({
  vertical,
  lifted,
  label,
  hint,
  side,
  onPointerDown,
  onKeyDown,
}: {
  vertical: boolean
  lifted: boolean
  label: string
  hint: string
  side: TooltipSide | null
  onPointerDown: (event: React.PointerEvent) => void
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  const cols = vertical ? 3 : 2
  const rows = vertical ? 2 : 3
  return (
    <Tooltip label={hint} side={side ?? undefined}>
      <button
        type="button"
        aria-label={label}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className={cn(
          "grid shrink-0 cursor-grab touch-none place-items-center rounded-lg outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-accent",
          vertical ? "h-5 w-9" : "h-9 w-5",
          lifted ? "cursor-grabbing text-ink-2" : "text-ink-icon hover:text-ink-2",
        )}
      >
        <svg width={cols * 5 - 2} height={rows * 5 - 2} aria-hidden>
          {Array.from({ length: cols * rows }, (_, index) => (
            <circle key={index} cx={1.5 + (index % cols) * 5} cy={1.5 + Math.floor(index / cols) * 5} r={1.5} fill="currentColor" />
          ))}
        </svg>
      </button>
    </Tooltip>
  )
}

export function Divider({ vertical }: { vertical: boolean }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center", vertical ? "h-[13px] w-9" : "h-9 w-[13px]")}>
      <span className={cn("bg-line", vertical ? "h-px w-5" : "h-5 w-px")} />
    </span>
  )
}
