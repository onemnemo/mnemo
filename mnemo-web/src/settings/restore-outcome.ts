/**
 * Reports how a profile restore ended. A restore finishes across a restart, and the window
 * reopens on whatever route the launch lands on, so the outcome is read once at app start
 * rather than by the Storage page, which is rarely where the app reopens.
 */

import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import type { TranslateFn } from "@/i18n/types"
import { toast } from "@/stores/toast"

import { consumeRestoreStatus, type RestoreStatus } from "./backup-api"

export function announceRestoreOutcome(t: TranslateFn, status: RestoreStatus): void {
  if (status.success) {
    toast.success(t("Settings", "RestoreComplete"), {
      description: t("Settings", "RestoreCompleteDescription", {
        folder: status.recoveryDirectoryName ?? "",
      }),
    })
    return
  }

  const discardedDescription =
    status.code === "restore_instance_running"
      ? "RestoreDiscardedInstanceRunning"
      : status.code === "restore_request_invalid"
        ? "RestoreDiscardedRequestInvalid"
        : null
  // Sticky: a restore that did not happen must not vanish before it is read.
  if (discardedDescription) {
    toast.warning(t("Settings", "RestoreFailed"), {
      description: t("Settings", discardedDescription),
      durationMs: 0,
    })
    return
  }

  toast.warning(t("Settings", "RestoreRolledBack"), {
    description: t("Settings", "RestoreRolledBackDescription"),
    durationMs: 0,
  })
}

let checked = false

/** Once per page load, so a StrictMode remount cannot race the host into reporting twice. */
export function announcePendingRestoreOutcome(): void {
  if (checked) return
  checked = true
  void consumeRestoreStatus()
    .then((status) => {
      if (!status) return
      announceRestoreOutcome(createTranslate(useI18nStore.getState().bundle), status)
    })
    .catch((error: unknown) => {
      console.error("[backup] could not read the restore outcome", error)
    })
}

/** Test seam: lets a test run the launch check more than once. */
export function resetRestoreOutcomeCheckForTests(): void {
  checked = false
}
