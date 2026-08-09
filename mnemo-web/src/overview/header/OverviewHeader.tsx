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
 * The page header: a greeting over today's date, plus the mode's actions.
 *
 * Edit mode swaps the date line for the hint and leaves the greeting alone. Replacing the whole
 * block with an "Editing" badge announced a mode the buttons on the same row already describe, and
 * moved the heading out from under the user mid-task.
 *
 * Both view-mode lines are recomputed on render rather than on a timer. A page left open across
 * midnight or across 18:00 keeps yesterday's date and the old greeting until something else
 * re-renders it, which is a fair trade against a timer that exists to update two lines of
 * decoration.
 */
export function OverviewHeader() {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  // The greeting stays blank until the profile resolves, so a name-less "Good evening" cannot flash
  // before the name arrives. Blank is the right suppression and the wrong rendering of it: a
  // skeleton holds the same line without looking like a failure.
  const settingsLoaded = useSettingsStore((state) => state.loaded)
  const userName = useSettingValue("User.DisplayName", "")

  const boardState = useOverviewStore((state) => state.boardState)
  const isEditMode = useOverviewStore((state) => state.isEditMode)
  const enterEdit = useOverviewStore((state) => state.enterEdit)
  const openLibrary = useOverviewStore((state) => state.openLibrary)
  const resetLayout = useOverviewStore((state) => state.resetLayout)
  const done = useOverviewStore((state) => state.done)

  const now = new Date()

  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {settingsLoaded ? (
          <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-ink">
            {greetingText(now, userName, t)}
          </h1>
        ) : (
          <Skeleton className="h-[26px] w-56" />
        )}
        {/* Not truncated: the date is short and the editing hint is a sentence, and half a
            sentence is worse than two lines of one. */}
        <p className="mt-0.5 text-[13px] text-ink-2">
          {isEditMode ? t("Overview", "EditingHint") : formatDayHeading(now, language)}
        </p>
      </div>

      {/* A board that failed to read offers nothing to customize: Done would have no board to
          write, and the store refuses to enter edit mode over one anyway. */}
      {boardState !== "ready" ? null : (
        <div className="flex shrink-0 items-center gap-2">
          {isEditMode ? (
            <>
              <Button
                variant="ghost"
                onClick={resetLayout}
                icon={<AppIcon name="rotate-ccw" size={14} strokeWidth={1.7} />}
              >
                {t("Overview", "ResetLayout")}
              </Button>
              <Button variant="outline" onClick={openLibrary} icon={<AppIcon name="plus" size={14} strokeWidth={2} />}>
                {t("Overview", "AddWidget")}
              </Button>
              <Button variant="solid" onClick={done} icon={<AppIcon name="check" size={14} strokeWidth={2.2} />}>
                {t("Overview", "Done")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={enterEdit}
              icon={<AppIcon name="layout-grid" size={14} strokeWidth={1.7} />}
            >
              {t("Overview", "Customize")}
            </Button>
          )}
        </div>
      )}
    </header>
  )
}
