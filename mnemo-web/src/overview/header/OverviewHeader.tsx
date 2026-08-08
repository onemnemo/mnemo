import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatDayHeading } from "@/lib/relative-date"
import { useSettingsStore, useSettingValue } from "@/settings/store"

import { useOverviewStore } from "../store"
import { greetingText } from "./greeting"

/**
 * The page header: a greeting over today's date, or the editing indicator, plus the mode's actions.
 *
 * Both view-mode lines are recomputed on render rather than on a timer, which is what the desktop
 * does. A page left open across midnight or across 18:00 keeps yesterday's date and the old
 * greeting until something else re-renders it, and that is a fair trade against a timer that exists
 * to update two lines of decoration.
 */
export function OverviewHeader() {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  // The desktop renders the greeting blank until the profile resolves, so a name-less "Good
  // evening" cannot flash before the name arrives. Blank is the right suppression and the wrong
  // rendering of it: a skeleton holds the same line without looking like a failure.
  const settingsLoaded = useSettingsStore((state) => state.loaded)
  const userName = useSettingValue("User.DisplayName", "")

  const boardState = useOverviewStore((state) => state.boardState)
  const isEditMode = useOverviewStore((state) => state.isEditMode)
  const enterEdit = useOverviewStore((state) => state.enterEdit)
  const done = useOverviewStore((state) => state.done)

  const now = new Date()

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {isEditMode ? (
          <div className="flex items-center gap-2">
            <span className="size-[7px] shrink-0 rounded-full bg-brand" />
            <span className="truncate text-body-small font-semibold text-text-primary">
              {t("Overview", "EditingTitle")}
            </span>
          </div>
        ) : settingsLoaded ? (
          <>
            <h1 className="truncate text-heading-4 font-semibold text-text-primary">
              {greetingText(now, userName, t)}
            </h1>
            <p className="text-body-small text-text-secondary">{formatDayHeading(now, language)}</p>
          </>
        ) : (
          <>
            <Skeleton className="h-6 w-56" />
            <p className="text-body-small text-text-secondary">{formatDayHeading(now, language)}</p>
          </>
        )}
      </div>

      {/* A board that failed to read offers nothing to customize: Done would have a board to write,
          and the store refuses to enter edit mode over one anyway. */}
      {boardState !== "ready" ? null : isEditMode ? (
        <Button size="sm" className="shrink-0" onClick={done}>
          {t("Overview", "Done")}
        </Button>
      ) : (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={enterEdit}>
          <AppIcon name="common/dashboard-customize" size={14} />
          {t("Overview", "Customize")}
        </Button>
      )}
    </div>
  )
}
