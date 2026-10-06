import { memo } from "react"

import { AppIcon } from "@/components/icon/AppIcon"

import type { OcclusionMask } from "../../facts/occlusion"
import { boxStyle, type Ring } from "./mask-style"

export interface MaskViewProps {
  mask: OcclusionMask
  number: number
  name: string
  grouped: boolean
  ring: Ring
  selected: boolean
  tabbable: boolean
  badge: boolean
  /** The image's displayed width and height in pixels, for placing the badge. */
  frameW: number
  frameH: number
  showMasks: boolean
  /** Enter or Space on the focused mask. */
  onActivate: (id: string) => void
  register: (id: string, element: HTMLDivElement | null) => void
}

/** A badge sits at the left of a wide rectangle and in the middle of anything else. */
function centersBadge(mask: OcclusionMask, frameW: number, frameH: number): boolean {
  return mask.shape !== "rect" || mask.w * frameW < mask.h * frameH * 1.5
}

/**
 * One mask as a listbox option. Polygons are painted by the SVG layer under it, so a polygon's
 * option is an invisible box over its bounds that still takes focus and carries the badge.
 */
export const MaskView = memo(function MaskView(props: MaskViewProps) {
  const { mask, number, name, grouped, ring, selected, tabbable, badge, frameW, frameH, showMasks } = props
  const polygon = mask.shape === "polygon"
  const visual = polygon ? {} : boxStyle(mask.shape === "ellipse", ring, showMasks)

  return (
    <div
      ref={(element) => props.register(mask.id, element)}
      role="option"
      aria-selected={selected}
      aria-label={name}
      tabIndex={tabbable ? 0 : -1}
      data-mask={mask.id}
      data-selected={selected ? "" : undefined}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !event.ctrlKey && !event.metaKey && !event.altKey) props.onActivate(mask.id)
      }}
      className="pointer-events-none absolute outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--solid)]"
      style={{
        ...visual,
        left: `${mask.x * 100}%`,
        top: `${mask.y * 100}%`,
        width: `${mask.w * 100}%`,
        height: `${mask.h * 100}%`,
      }}
    >
      {badge && (
        <span
          data-testid="mask-badge"
          aria-hidden="true"
          className="absolute inline-flex h-[18px] min-w-[18px] items-center justify-center gap-[3px] rounded-[5px] bg-solid px-[5px] text-[11px] leading-none font-semibold text-solid-fg tabular-nums"
          style={
            centersBadge(mask, frameW, frameH)
              ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
              : { left: 5, top: "50%", transform: "translateY(-50%)" }
          }
        >
          {number}
          {grouped && <AppIcon name="link" size={11} strokeWidth={2.6} />}
        </span>
      )}
    </div>
  )
})
