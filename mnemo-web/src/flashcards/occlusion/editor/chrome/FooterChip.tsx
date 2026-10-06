import type { ComponentProps } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { tPlural } from "@/i18n/plural"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

type FooterChipProps = ComponentProps<"button"> & {
  /** Cards the fact makes. */
  count: number
  /** Cards the save would move to the trash. */
  removed: number
  /** Draws a button with a chevron, for a window too small to show the Cards list. */
  expandable: boolean
}

/** "Makes N cards", with ", removes N" in red when the edit takes cards away. */
export function FooterChip({ count, removed, expandable, className, ...rest }: FooterChipProps) {
  const t = useT()
  const shared = cn("flex h-[30px] items-center gap-1.5 rounded-lg bg-canvas-sunken px-3 text-[11.5px] font-medium text-ink-2", className)
  const body = (
    <>
      <AppIcon name="layers" size={13} strokeWidth={1.8} />
      <span>
        {count === 0
          ? t("Flashcards", "FactMakesNoCards")
          : tPlural(t, "Flashcards", { one: "FactMakesCardsOne", many: "FactMakesCardsMany" }, count)}
        {removed > 0 ? (
          <span data-testid="chip-removes" className="text-danger">
            {tPlural(t, "Flashcards", { one: "FactRemovesCardsOne", many: "FactRemovesCardsMany" }, removed)}
          </span>
        ) : null}
      </span>
      {expandable ? <AppIcon name="chevron-up" size={11} strokeWidth={2.4} className="text-ink-3" /> : null}
    </>
  )

  return expandable ? (
    <button type="button" {...rest} className={cn(shared, "outline-none hover:bg-frame-hover focus-visible:ring-2 focus-visible:ring-accent")}>
      {body}
    </button>
  ) : (
    <div className={shared}>{body}</div>
  )
}
