import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { openExternally } from "@/lib/external"
import { isUpdateWorking, nextUpdateAction, offersSkip, updateNote, type UpdateActionKind } from "@/updates/presentation"
import { useUpdateStore } from "@/updates/store"

import { formatVersion } from "../../version"
import { SettingRowShell } from "../SettingRowShell"

/** Where a build that cannot update itself sends the user instead. */
const RELEASES_URL = "https://github.com/onemnemo/mnemo/releases"

/**
 * The whole updater in one row: the version, what the updater is doing, and the single
 * thing to press about it. Which of those it is comes from the stage the host reports,
 * so the button cannot offer to install something that has not been downloaded.
 *
 * Skipping sits beside it only while there is a version to name, and quiets the prompt
 * rather than the update: the main button keeps offering it, because someone who asked
 * the app to stop bringing it up has not said they will never install it.
 */
export function CheckForUpdatesRow({ title, divider }: { title: string; divider: boolean }) {
  const t = useT()
  const status = useUpdateStore((s) => s.status)
  const busy = useUpdateStore((s) => s.busy)

  const note = updateNote(status)
  const action = nextUpdateAction(status)

  return (
    <SettingRowShell
      title={title}
      description={
        <>
          {t("Settings", "CurrentVersionLabelFormat", { 0: formatVersion(status?.version) })}
          {note ? <span className="mt-0.5 block">{t("Settings", note.key, note.params)}</span> : null}
        </>
      }
      divider={divider}
    >
      <div className="flex items-center gap-2">
        {offersSkip(status) && (
          <Button
            variant="ghost"
            size="sm"
            disabled={status?.skipped}
            onClick={() => void useUpdateStore.getState().skip()}
          >
            {t("Settings", "SkipThisVersion")}
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={isUpdateWorking(status, busy)} onClick={() => run(action.kind)}>
          {t("Settings", action.label)}
        </Button>
      </div>
    </SettingRowShell>
  )
}

function run(kind: UpdateActionKind): void {
  const store = useUpdateStore.getState()
  switch (kind) {
    case "apply":
      void store.apply()
      return
    case "download":
      void store.download()
      return
    case "open-releases":
      openExternally(RELEASES_URL)
      return
    case "check":
      void store.check(false)
      return
  }
}
