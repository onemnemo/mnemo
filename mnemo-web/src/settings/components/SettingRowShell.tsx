import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The settings row anatomy: title and optional description on the left, exactly one
 * control on the right, separated from the next row by a hairline.
 *
 * The measure is what makes this readable, and it lives on the page rather than here:
 * a row that runs to the window edge strands a control several hundred pixels from
 * its own label, and a label and control pair has to read as one object.
 */
export function SettingRowShell({
  title,
  description,
  children,
  divider = true,
  dimmed = false,
  align = "center",
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Suppressed on the last row of a run, so a section does not end on a line. */
  divider?: boolean
  /** Rows that are visible but not currently actionable. */
  dimmed?: boolean
  /** `start` for controls taller than a line: swatch grids, key lists. */
  align?: "center" | "start"
}) {
  return (
    <div
      className={cn(
        // Wraps rather than squeezing: the controls are fixed-width, so in a narrow
        // window the label column would otherwise shrink until every word breaks.
        "flex flex-wrap justify-between gap-x-8 gap-y-2.5 py-3",
        align === "center" ? "items-center" : "items-start",
        divider && "border-b border-line-soft",
        dimmed && "opacity-60",
      )}
    >
      <div className="min-w-[15rem] flex-1">
        <div className="text-[13.5px] text-ink">{title}</div>
        {description ? <div className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{description}</div> : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  )
}
