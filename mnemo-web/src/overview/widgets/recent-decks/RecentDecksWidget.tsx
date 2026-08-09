import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { Body, Empty, Head, ItemRow, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useRecentDecks } from "./useRecentDecks"

/**
 * A short list of recently practiced decks, each row opening the deck.
 *
 * The row recipe is the shared ItemRow, same as RecentNotes. The two differ only in what goes in
 * the meta column, which is the whole point of having one row component.
 */
export function RecentDecksWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const decks = useRecentDecks(instance, manifest)

  return (
    <Body>
      <Head title={title} icon="square-stack" />

      {decks.state === "loading" ? (
        <div className="mt-2 flex-1">
          <WidgetLoading rows={4} />
        </div>
      ) : decks.state === "error" ? (
        <WidgetError onRetry={decks.retry} />
      ) : decks.state === "empty" ? (
        <Empty>{t("RecentDecks", "EmptyWindow")}</Empty>
      ) : (
        // The scrollbar is hidden rather than absent: a 2x1 tile holds two rows of a five-row list,
        // and a visible track inside a 120px card costs more width than it explains.
        <div className="scroll-thin mt-1.5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {decks.rows.map((row) => (
            <ItemRow
              key={row.deckId}
              glyph={<AppIcon name="square-stack" size={14} strokeWidth={1.6} className="text-ink-icon" />}
              title={row.name}
              meta={row.lastPracticed}
              href={`#/flashcard-deck/${row.deckId}`}
            />
          ))}
        </div>
      )}
    </Body>
  )
}
