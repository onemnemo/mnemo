import { describeError } from "@/api/error-copy"
import { announceExport, chooseExportTarget, exportSaveOptions, saveServerExport } from "@/api/export-file"
import type { TranslateFn } from "@/i18n/types"
import { toast } from "@/stores/toast"

import { requestBackupExport } from "./backup-api"

/** The extension the host recognises a whole-profile backup by. */
export const BACKUP_FILE_EXTENSION = ".mnemo-backup"

/** The name the chooser opens on: the translated stem, dated, with the backup extension. */
export function backupFileName(t: TranslateFn, now = new Date()): string {
  return `${t("Settings", "BackupFileName", { date: now.toISOString().slice(0, 10) })}${BACKUP_FILE_EXTENSION}`
}

/** The backup under way, if any. One at a time across every surface that can start one. */
let inFlight: Promise<void> | null = null

/**
 * Creates a complete profile backup where the user chooses to put it.
 *
 * One implementation for every surface that offers a backup, so each produces the same file and
 * reports it the same way: a progress toast once the destination is settled, turned into the
 * completion or the failure. Dismissing the chooser is a decision rather than a result, so nothing
 * is said about it. A start while one is already running joins that run instead of opening a
 * second chooser over the same profile. Resolves once the surface can go back to idle, and never
 * throws.
 */
export function createProfileBackup(t: TranslateFn): Promise<void> {
  if (!inFlight) {
    inFlight = runProfileBackup(t).finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

async function runProfileBackup(t: TranslateFn): Promise<void> {
  let progressToastId: string | null = null
  try {
    const request = { fileName: backupFileName(t), ...exportSaveOptions((key) => t("Common", key)) }
    const target = await chooseExportTarget(request)
    if (target.status === "declined") return

    progressToastId = toast.progress(t("Settings", "BackingUp"), { description: request.fileName })
    const outcome = await saveServerExport(request, (grant) => requestBackupExport(grant), target)
    announceExport(
      outcome,
      { title: t("Settings", "BackupComplete"), downloaded: t("Common", "TransferExportFinished") },
      progressToastId,
    )
  } catch (error) {
    const title = t("Settings", "BackupFailed")
    const description = describeError(t, error)
    if (progressToastId) toast.update(progressToastId, { type: "warning", title, description })
    else toast.warning(title, { description })
  }
}
