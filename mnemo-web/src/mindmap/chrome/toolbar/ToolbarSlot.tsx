import type { ReactNode } from "react"

import { Tooltip } from "@/components/ui/tooltip"
import type { TooltipSide } from "@/components/ui/tooltip/placement"
import { cn } from "@/lib/utils"

import { MenuMark } from "../bits"

export interface ToolbarSlotProps {
  /** Which tool this is, for finding its button again. */
  readonly id: string
  readonly label: string
  /** What the tooltip says, when it names more than the tool: the mode Select is in, for one. */
  readonly hint?: string
  readonly chord?: string | null
  /** Which side of the bar a tooltip opens on, or none at all while the bar is being carried. */
  readonly tip: TooltipSide | null
  /** Armed. The chip under the slot is what shows it; the slot only changes its ink. */
  readonly armed: boolean
  /** Present when the tool owns a group, saying whether that group is open. */
  readonly menu?: { readonly open: boolean }
  readonly vertical: boolean
  readonly onPress: () => void
  readonly children: ReactNode
}

/** One tool on the toolbar, a 36 square the sliding chip can sit under. */
export function ToolbarSlot({ id, label, hint, chord, tip, armed, menu, vertical, onPress, children }: ToolbarSlotProps) {
  return (
    <Tooltip label={tip ? (hint ?? label) : ""} chord={chord} side={tip ?? undefined}>
      <button
        type="button"
        data-tb-tool={id}
        aria-label={label}
        aria-keyshortcuts={chord ?? undefined}
        aria-pressed={armed}
        aria-haspopup={menu ? "true" : undefined}
        aria-expanded={menu ? menu.open : undefined}
        // A pointer press leaves the focus on the canvas, so the map's own keys keep working
        // straight after picking a tool. The keyboard still focuses the button as usual.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPress}
        // The ink eases slower than the fill, so the icon turning light as the chip arrives under it
        // does not flash against the bar before the chip gets there.
        style={{ transition: "color var(--duration-slow) ease, background-color var(--duration-normal) ease" }}
        className={cn(
          "relative z-[1] grid size-9 shrink-0 place-items-center rounded-[10px] outline-none",
          "focus-visible:ring-2 focus-visible:ring-accent",
          vertical ? "my-px" : "mx-px",
          armed ? "text-solid-fg" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
        )}
      >
        {children}
        {menu ? <MenuMark /> : null}
      </button>
    </Tooltip>
  )
}
