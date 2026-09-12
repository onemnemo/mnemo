import { useCallback, useRef, useState } from "react"

import { useT } from "@/i18n/useT"

import { createProfileBackup } from "./backup-export"

export interface ProfileBackupControl {
  /** A backup is under way: the chooser is up, or the host is writing the file. */
  busy: boolean
  /** What the button says right now. */
  label: string
  /** Starts a backup, or does nothing while one is already running. */
  start: () => void
}

/**
 * The backup button's state, for any surface that renders one.
 *
 * The guard lives in a ref as well as in state because a second press can land before the render
 * that disables the button. The command would only hand that press the run already under way, but
 * the surface should not be asking twice.
 */
export function useProfileBackup(): ProfileBackupControl {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const running = useRef(false)

  const start = useCallback(() => {
    if (running.current) return
    running.current = true
    setBusy(true)
    void createProfileBackup(t).finally(() => {
      running.current = false
      setBusy(false)
    })
  }, [t])

  return { busy, label: t("Settings", busy ? "BackingUp" : "BackUp"), start }
}
