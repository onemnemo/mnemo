import { useState } from "react"

import { useSettingsStore } from "@/settings/store"
import { useDialogStore } from "@/stores/dialog"
import { useUpdateStore } from "@/updates/store"

import { BetaNotice } from "./BetaNotice"
import { acknowledgeBetaNotice, needsBetaNotice } from "./beta-notice"

/**
 * Mounted once, and empty until the settings snapshot and the updater's status agree that this
 * launch is the first of a beta build. It opens behind first-time setup's exit, which is the
 * order to read them in: what this app is, then what this build is.
 */
export function BetaNoticeHost() {
  const status = useUpdateStore((s) => s.status)
  const version = status?.version ?? null
  const runningChannel = status?.runningChannel ?? null
  const due = useSettingsStore((s) =>
    needsBetaNotice(s, version !== null && runningChannel !== null ? { version, runningChannel } : null),
  )
  // The queued dialog host owns the window while it has a question up, the exit confirmation
  // included, and the notice waits underneath rather than closing.
  const dialogPending = useDialogStore((s) => s.queue.length > 0)
  // Held here rather than read back from the setting, because the write is optimistic and a
  // failed one rolls back. Without this the notice would return over the page the user had just
  // moved on to; instead the next launch asks again.
  const [answered, setAnswered] = useState<string | null>(null)

  if (!due || version === null || answered === version) return null

  return (
    <BetaNotice
      version={version}
      suspended={dialogPending}
      onContinue={() => {
        setAnswered(version)
        void acknowledgeBetaNotice(version)
      }}
    />
  )
}
