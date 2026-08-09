import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

/**
 * The body of a tile whose widget could not be shown.
 *
 * Two unrelated causes land here, and the tile is deliberately the same for both: no widget is
 * registered under this id, or one is and rendering it threw. The user cannot act differently on
 * the two, and the stored row is equally intact either way.
 *
 * The id is printed because nothing else on the tile says it. Widgets draw their own heading now,
 * and this one has no manifest to draw a name from, so the id is the only thing that identifies
 * which extension is missing. Mono, because it is an identifier and not a title.
 */
export function UnavailableTile({ widgetId }: { widgetId?: string }) {
  const t = useT()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3.5 text-center">
      <AppIcon name="triangle-alert" size={22} strokeWidth={1.5} className="text-ink-icon" />
      <p className="text-[13px] font-medium text-ink-2">{t("Overview", "WidgetUnavailable")}</p>
      {widgetId && <p className="max-w-full truncate font-mono text-[11px] text-ink-3">{widgetId}</p>}
      <p className="text-[12px] leading-[16px] text-ink-3">{t("Overview", "WidgetUnavailableHint")}</p>
    </div>
  )
}
