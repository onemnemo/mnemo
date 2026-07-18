import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The settings row anatomy: title and optional description on the left, a control on
 * the right, separated from the next row by a hairline. Mirrors the desktop's
 * SettingsRow control, including its 14px vertical rhythm.
 */
export function SettingRowShell({
  title,
  description,
  children,
  divider = true,
  dimmed = false,
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Suppressed on the last row of a run, so a section does not end on a line. */
  divider?: boolean
  /** Rows that are visible but not currently actionable. */
  dimmed?: boolean
}) {
  return (
    <div
      className={cn(
        // Wraps rather than squeezing: the controls are fixed-width, so in a narrow
        // window the label column would otherwise shrink until every word breaks.
        "flex flex-wrap items-center gap-x-6 gap-y-2.5 py-3.5",
        divider && "border-b border-divider-subtle",
        dimmed && "opacity-60",
      )}
    >
      <div className="min-w-[15rem] flex-1 space-y-0.5">
        <div className="text-body-small font-medium text-text-primary">{title}</div>
        {description ? (
          <div className="text-body-extra-small leading-[17px] text-text-tertiary">{description}</div>
        ) : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  )
}
