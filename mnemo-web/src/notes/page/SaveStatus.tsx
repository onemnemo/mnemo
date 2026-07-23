import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import type { SaveState } from "../authority/authority"

/**
 * What the editor is doing with your work.
 *
 * Quiet by default and loud only when it has to be. "Saved" and "Saving" are one
 * dim line, because a note that is saving normally is not news; a failure or a
 * conflict is, because in both cases the text on screen is not the text on disk
 * and only the user can decide what to do about it.
 *
 * Every state floats in the viewport's bottom-right corner rather than sitting
 * in the note's flow: the indicator appears the moment the note is first
 * touched, and an in-flow line appearing there shoved the whole document down
 * a row mid-keystroke. The quiet pill takes no pointer events, so it never
 * blocks a click on text scrolled beneath it.
 */
export function SaveStatus({ state, onReload }: { state: SaveState; onReload: () => void }) {
  const t = useT()
  const nt = (key: string) => t("Notes", key)

  if (state === "version_conflict") {
    return (
      <div className="fixed bottom-4 right-5 z-30 flex max-w-xs items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 shadow-lg">
        <AppIcon name="common/triangle-alert" size={14} className="mt-0.5 shrink-0 text-text-tertiary" />
        <div className="flex flex-col gap-1.5">
          <span className="text-body-small font-medium text-text-primary">{nt("SaveStateConflict")}</span>
          <span className="text-body-small text-text-tertiary">{nt("SaveStateConflictDescription")}</span>
          <Button size="sm" variant="outline" className="self-start" onClick={onReload}>
            {nt("SaveStateReload")}
          </Button>
        </div>
      </div>
    )
  }

  if (state === "save_failed") {
    return (
      <div className="fixed bottom-4 right-5 z-30 flex max-w-xs items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 shadow-lg">
        <AppIcon name="common/triangle-alert" size={14} className="mt-0.5 shrink-0 text-text-tertiary" />
        <div className="flex flex-col gap-0.5">
          <span className="text-body-small font-medium text-text-primary">{nt("SaveStateFailed")}</span>
          <span className="text-body-small text-text-tertiary">{nt("SaveStateFailedDescription")}</span>
        </div>
      </div>
    )
  }

  const quiet =
    state === "saving"
      ? nt("SaveStateSaving")
      : state === "dirty"
        ? nt("SaveStateUnsaved")
        : state === "saved"
          ? nt("SaveStateSaved")
          : null

  // Nothing to report for a note that has been loaded and not yet touched.
  if (quiet === null) return null

  return (
    <span className="pointer-events-none fixed bottom-4 right-5 z-30 rounded-full border border-line bg-surface px-2.5 py-1 text-body-small text-text-tertiary">
      {quiet}
    </span>
  )
}
