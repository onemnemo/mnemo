import type { StudySessionDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useReviewSettings } from "../../presets/store"

/**
 * The session's own thin bar. Everything it needs to say fits on one line so the card gets the
 * rest of the window: close, the deck, whether this run touches the schedule, and how far in.
 *
 * The new/learning/due breakdown the server tracks is deliberately not here - the design keeps
 * this line to a single progress bar, and the deck page is where that breakdown is read.
 */
export function SessionTopbar({
  session,
  active,
  onClose,
}: {
  session: StudySessionDto | null
  active: boolean
  onClose: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const cram = session?.mode === "cram"
  const progress = session?.progress
  const fill = progress && progress.total > 0 ? (progress.completed / progress.total) * 100 : 0

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-4">
      <IconBtn icon="common/x" label={fc("StudyClose")} onClick={onClose} />

      <span className="max-w-[240px] shrink-0 truncate text-[13px] font-medium text-ink">
        {session?.deckName ?? ""}
      </span>

      {session && (
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
            cram ? "bg-state-learn-wash text-state-learn" : "bg-canvas-sunken text-ink-2",
          )}
        >
          {fc(cram ? "StudyModeChipCram" : "StudyModeChipReview")}
        </span>
      )}

      <div className="flex-1" />

      {active && progress && (
        <>
          <span className="shrink-0 text-[12.5px] tabular-nums text-ink-3">
            {fc("StudyProgressFormat", { 0: progress.completed, 1: progress.total })}
          </span>
          <span className="h-1 w-40 shrink-0 overflow-hidden rounded-full bg-canvas-sunken">
            <span
              className="block h-full rounded-full bg-ink-3 transition-[width] duration-300 ease-out"
              style={{ width: `${fill}%` }}
            />
          </span>
        </>
      )}

      {/* Editing the preset mid-session is allowed, but the queue this session is running was
          already built - the new limits and order apply from the next one, as on the desktop. */}
      <IconBtn
        icon="settings-2"
        label={fc("ReviewSettingsMenu")}
        disabled={!session}
        onClick={() => session && useReviewSettings.getState().open(session.deckId, session.deckName)}
      />
    </header>
  )
}

function IconBtn({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-2 transition-colors",
        "hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35",
      )}
    >
      <AppIcon name={icon} size={16} />
    </button>
  )
}
