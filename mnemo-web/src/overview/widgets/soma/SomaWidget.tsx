import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { useSomaStore } from "@/stores/soma"

import { Body, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"

const NS = "WidgetSoma"

/** The two prompts the wide composition offers. Keys, so they read in the reader's own language. */
const SUGGESTIONS = ["SuggestionQuiz", "SuggestionStruggle"] as const

/**
 * The one widget allowed to spend the brand orange, and only on the mark, the same rule as the
 * sidebar logo and the due badge.
 *
 * The field is a button dressed as an input: typing happens in the dock, and pretending otherwise
 * would make the first keystroke feel like a bug.
 */
export function SomaWidget({ manifest, renderColumns }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const openDock = useSomaStore((state) => state.setDockOpen)

  const mark = (
    <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-accent-wash">
      <AppIcon name="orbit" size={12} strokeWidth={2} className="text-accent-ink" />
    </span>
  )

  if (renderColumns < 2) {
    return (
      <Body>
        <button type="button" onClick={() => openDock(true)} className="flex h-full w-full flex-col text-left">
          <div className="flex items-center gap-2">
            {mark}
            <span className="text-[12px] font-medium text-ink-3">{title}</span>
          </div>
          <p className="mt-auto text-[13px] leading-snug text-ink">{t(NS, "NarrowPitch")}</p>
        </button>
      </Body>
    )
  }

  return (
    <Body>
      <div className="flex shrink-0 items-center gap-2">
        {mark}
        <span className="text-[12px] font-medium text-ink-3">{title}</span>
      </div>

      <button
        type="button"
        onClick={() => openDock(true)}
        className={cn(
          "mt-1.5 flex h-8 w-full shrink-0 items-center rounded-lg bg-canvas-sunken px-2.5",
          "text-left text-[12.5px] text-ink-3 transition-colors hover:bg-frame-active",
        )}
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        {t(NS, "AskPlaceholder")}
      </button>

      <div className="mt-1.5 flex min-w-0 gap-1.5">
        {SUGGESTIONS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => openDock(true)}
            className="min-w-0 truncate rounded-md px-1.5 py-1 text-[11.5px] text-ink-2 shadow-[0_0_0_1px_var(--line-soft)] transition-colors hover:bg-frame-hover hover:text-ink"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {t(NS, key)}
          </button>
        ))}
      </div>
    </Body>
  )
}
