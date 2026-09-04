import type { CardViewDto } from "@/api/types"
import { useT } from "@/i18n/useT"

import { StateTag, cardStateKind } from "@/flashcards/bits"
import { CardPeekBody } from "@/flashcards/browse/components/CardPeekBody"
import { dueLabel } from "@/flashcards/deck/cards"

/**
 * One card in the peek: the same reading the browser's quick look gives, without the
 * dialog around it. Everything that would edit the card lives on the deck page, which
 * Open Full is for.
 */
export function CardPeekPane({ view }: { view: CardViewDto }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const { card, schedule } = view
  const due = dueLabel(view, Date.now(), fc)

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex items-center gap-3 text-[12px] text-ink-3">
        <StateTag state={cardStateKind(card, schedule)} />
        <span className={due.isDue ? "font-medium text-state-due" : undefined}>{due.text}</span>
        <span>
          {fc("ColLapses")}: {schedule.lapses}
        </span>
      </div>
      <CardPeekBody card={card} />
    </div>
  )
}
