import { navigate } from "@/app/router"
import { useT } from "@/i18n/useT"

import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading, WidgetMessage } from "../states"
import { useRecentDecks } from "./useRecentDecks"

/**
 * A short list of recently practiced decks, each row opening the deck.
 *
 * The row recipe is RecentNotes', with a third column for the last-practiced date. Identical at
 * both supported sizes; the taller tile simply shows more of the same list.
 */
export function RecentDecksWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const decks = useRecentDecks(instance, manifest)

  if (decks.state === "loading") return <WidgetLoading rows={4} />
  if (decks.state === "error") return <WidgetError onRetry={decks.retry} />
  if (decks.state === "empty") return <WidgetMessage>{t("RecentDecks", "EmptyWindow")}</WidgetMessage>

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {decks.rows.map((row) => (
        <div key={row.deckId} className="border-t border-divider-subtle">
          <button
            type="button"
            onClick={() => navigate("flashcard-deck", row.deckId)}
            className="flex min-h-[34px] w-full cursor-pointer items-center gap-3 rounded-sm px-1 text-left transition-colors hover:bg-[var(--list-item-hover-background)]"
          >
            <span className="min-w-0 flex-1 truncate text-body-small font-medium text-text-primary">{row.name}</span>
            <span className="shrink-0 truncate text-caption text-text-tertiary">{row.meta}</span>
            <span className="shrink-0 truncate text-caption text-text-tertiary">{row.lastPracticed}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
