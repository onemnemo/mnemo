import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The settings measure.
 *
 * A row that runs to the window edge strands every control several hundred pixels
 * from its own label. A settings row is a label and control pair and has to read
 * as one object, so it gets a measure like any other line of text.
 */
export const MEASURE = 660

export function SettingsPageShell({
  title,
  description,
  children,
}: {
  /** Omitted by a page the settings chrome already titles, so the heading is not printed twice. */
  title?: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto px-10 pb-24 pt-9" style={{ maxWidth: MEASURE }}>
        {title && <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>}
        {description && <p className="mt-1 text-[13.5px] text-ink-2">{description}</p>}
        {children}
      </div>
    </div>
  )
}

/**
 * Sentence case, not letterspaced uppercase. An all-caps micro-label shouts a
 * word like "APPLICATION" louder than the page title it sits under.
 */
export function Section({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      {title && <h2 className="text-[12.5px] font-medium text-ink-3">{title}</h2>}
      {note && <p className="mt-0.5 text-[12.5px] text-ink-3">{note}</p>}
      <div className="mt-1 [&>*+*]:border-t [&>*+*]:border-line-soft">{children}</div>
    </section>
  )
}

/** Label and description on the left, exactly one control on the right. */
export function Row({
  label,
  description,
  children,
  align = "center",
}: {
  label: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** `start` for controls taller than a line: swatch grids, key lists. */
  align?: "center" | "start"
}) {
  return (
    <div className={cn("flex justify-between gap-8 py-3", align === "center" ? "items-center" : "items-start")}>
      <div className="min-w-0">
        <p className="text-[13.5px] text-ink">{label}</p>
        {description && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{description}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

/** A stacked block, for controls that need the full measure to themselves. */
export function Block({
  label,
  description,
  children,
}: {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="py-3.5">
      <p className="text-[13.5px] text-ink">{label}</p>
      {description && <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p>}
      <div className="mt-3">{children}</div>
    </div>
  )
}
