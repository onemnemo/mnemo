import { AppIcon } from "@/components/icon/AppIcon"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatSmart } from "@/lib/relative-date"

import { settingInt } from "../../config/encode"
import { Body, Empty, Head, ItemRow, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useRecent } from "./useRecent"

const NS = "WidgetRecent"

/** Notes and decks in one list, newest first. Rows open the thing they name. */
export function RecentWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  const title = useWidgetTitle(manifest)

  // A short tile holds two rows however many the setting asks for, so the fetch is bounded by the
  // room as well as by the choice. Asking for six and drawing two is four rows of wasted work.
  const room = instance.size.rows >= 2 ? 6 : 2
  const limit = Math.min(room, settingInt(manifest, instance.settings, "count"))
  const recent = useRecent(limit)

  const now = Date.now()

  return (
    <Body>
      <Head title={title} icon="clock" />

      {recent.state === "loading" ? (
        <div className="mt-2 flex-1">
          <WidgetLoading rows={limit} />
        </div>
      ) : recent.state === "error" ? (
        <WidgetError onRetry={recent.retry} />
      ) : recent.state === "empty" ? (
        <Empty>{t(NS, "EmptyState")}</Empty>
      ) : (
        <div className="mt-1.5 flex min-h-0 flex-1 flex-col justify-center">
          {recent.rows.map((row) => (
            <ItemRow
              key={`${row.kind}-${row.id}`}
              glyph={
                row.icon ?? (
                  <AppIcon
                    name={row.kind === "note" ? "file-text" : "square-stack"}
                    size={14}
                    strokeWidth={1.6}
                    className="text-ink-icon"
                  />
                )
              }
              title={row.title}
              meta={formatSmart(new Date(row.touchedAt), now, t, language)}
              href={row.href}
            />
          ))}
        </div>
      )}
    </Body>
  )
}
