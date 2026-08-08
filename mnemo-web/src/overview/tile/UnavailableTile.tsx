import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

/**
 * The body of a tile whose widget could not be shown.
 *
 * Two unrelated causes land here, and the tile is deliberately the same for both: no widget is
 * registered under this id, or one is and rendering it threw. The user cannot act differently on
 * the two, and the stored row is equally intact either way.
 *
 * The remove control is not here. It sits in the tile's header, in the slot the title shares, and
 * splitting one grid across two components to keep the placeholder's parts together would make the
 * header harder to read than this comment makes it.
 */
export function UnavailableTile() {
  const t = useT()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 pt-0.5 pb-1">
      <AppIcon name="common/triangle-alert" size={24} className="text-text-tertiary" />
      <p className="text-body-small font-semibold text-text-secondary">{t("Overview", "WidgetUnavailable")}</p>
      <p className="text-caption text-text-tertiary text-center">{t("Overview", "WidgetUnavailableHint")}</p>
    </div>
  )
}
