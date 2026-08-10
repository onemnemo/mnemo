import { useT } from "@/i18n/useT"

import { Body, Empty, Head, ItemRow, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useLeeches } from "./useLeeches"

const NS = "WidgetLeeches"

/** The cards that keep getting failed, worst first. Rows open the deck the card lives in. */
export function LeechesWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const leeches = useLeeches()

  const tall = instance.size.rows >= 2
  const rows = leeches.rows.slice(0, tall ? 6 : 2)

  return (
    <Body>
      <Head
        title={title}
        icon="triangle-alert"
        right={
          leeches.state === "ready" ? (
            <span className="text-[11.5px] tabular-nums text-ink-3">{leeches.total}</span>
          ) : undefined
        }
      />

      {leeches.state === "loading" ? (
        <div className="mt-2 flex-1">
          <WidgetLoading rows={tall ? 4 : 2} />
        </div>
      ) : leeches.state === "error" ? (
        <WidgetError onRetry={leeches.retry} />
      ) : leeches.state === "empty" ? (
        <Empty>{t(NS, "EmptyState")}</Empty>
      ) : (
        <div className="mt-1.5 flex min-h-0 flex-1 flex-col justify-center">
          {rows.map((row) => (
            <ItemRow
              key={row.cardId}
              // Neutral. The lapse count on the right already says how bad it is; a warning colour
              // on every row would make a widget about three cards look like an emergency.
              glyph={<span className="size-[6px] rounded-full bg-ink-3/50" />}
              title={row.front}
              meta={t(NS, "LapseCountFormat", { 0: row.lapses })}
              href={`#/flashcard-deck/${row.deckId}`}
            />
          ))}
        </div>
      )}
    </Body>
  )
}
