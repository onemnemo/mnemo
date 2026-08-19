import type { CardTypeDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { asFactLike, type FactDraft } from "../fact-draft"
import { dormant, generate } from "../generation"

/**
 * What the material would make if it were saved now, counted as it is typed.
 *
 * Cards come from material rather than being authored one at a time, so without this the number of
 * cards a save produces is only discoverable by saving. The layouts that are not firing are named
 * beside it, because "fill this in and you get another card" is the part that is otherwise
 * invisible.
 */
export function CardCountBar({ type, draft }: { type: CardTypeDto | undefined; draft: FactDraft }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  if (!type) return null

  const fact = asFactLike(draft)
  const count = generate(type, fact).length
  const waiting = dormant(type, fact)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-canvas-sunken px-3 py-2 text-[11.5px]">
      <span className="flex items-center gap-1.5 font-medium text-ink-2">
        <AppIcon name="layers" size={13} strokeWidth={1.8} />
        {count === 0 ? fc("FactMakesNoCards") : count === 1 ? fc("FactMakesOneCard") : fc("FactMakesCardsFormat", { 0: count })}
      </span>

      {waiting.map((entry) => (
        <span key={entry.layout.id} className="text-ink-3">
          {fc("FactWaitingFormat", { 0: entry.requiredFieldName, 1: entry.layout.name })}
        </span>
      ))}
    </div>
  )
}
