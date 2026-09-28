import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { Point } from "../../model/scene"
import type { DockEdge, Size } from "./placement"

const HINT: Record<DockEdge, string> = {
  bottom: "ToolbarReleaseBottom",
  top: "ToolbarReleaseTop",
  left: "ToolbarReleaseLeft",
  right: "ToolbarReleaseRight",
}

export interface DropSpot {
  readonly edge: DockEdge
  readonly at: Point
  readonly size: Size
}

/** Where the bar can land while it is being carried, and which of them it will land on. */
export function ToolbarDropZones({ spots, target }: { spots: readonly DropSpot[]; target: DockEdge }) {
  const t = useT()

  return (
    <>
      {spots.map((spot) => (
        <div
          key={spot.edge}
          aria-hidden
          className={cn(
            "pointer-events-none absolute rounded-2xl border-[1.5px] border-dashed transition-colors duration-[var(--duration-slow)]",
            spot.edge === target ? "border-accent bg-accent/10" : "border-[var(--line)]",
          )}
          style={{ left: spot.at.x, top: spot.at.y, width: spot.size.width, height: spot.size.height }}
        />
      ))}
      <p
        role="status"
        className="pointer-events-none absolute top-[88px] left-1/2 flex h-8 -translate-x-1/2 items-center rounded-full bg-solid px-3.5 text-[13px] whitespace-nowrap text-solid-fg shadow-pop"
      >
        {t("Mindmap", HINT[target])}
      </p>
    </>
  )
}
