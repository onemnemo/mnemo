import { Skeleton } from "@/components/ui/skeleton"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatDayHeading } from "@/lib/relative-date"
import { useSettingsStore, useSettingValue } from "@/settings/store"

import { greetingText } from "./greeting"

/**
 * The page header: a greeting over today's date.
 *
 * Both lines are recomputed on render rather than on a timer, which is what the desktop does. A
 * page left open across midnight or across 18:00 keeps yesterday's date and the old greeting until
 * something else re-renders it, and that is a fair trade against a timer that exists to update two
 * lines of decoration.
 *
 * The edit-mode variant of this row, and the action buttons beside it, arrive with the modes they
 * open rather than as controls that lead nowhere.
 */
export function OverviewHeader() {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  // The desktop renders the greeting blank until the profile resolves, so a name-less "Good
  // evening" cannot flash before the name arrives. Blank is the right suppression and the wrong
  // rendering of it: a skeleton holds the same line without looking like a failure.
  const settingsLoaded = useSettingsStore((state) => state.loaded)
  const userName = useSettingValue("User.DisplayName", "")

  const now = new Date()

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {settingsLoaded ? (
          <h1 className="truncate text-heading-4 font-semibold text-text-primary">
            {greetingText(now, userName, t)}
          </h1>
        ) : (
          <Skeleton className="h-6 w-56" />
        )}
        <p className="text-body-small text-text-secondary">{formatDayHeading(now, language)}</p>
      </div>
    </div>
  )
}
