import { useEffect, useState } from "react"

import { ApiError } from "@/api/client"
import { describeError } from "@/api/error-copy"
import {
  allowNextControlledShutdown,
  cancelControlledShutdown,
  waitForControlledShutdownStart,
} from "@/app/shutdown"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useT } from "@/i18n/useT"
import { useI18nStore } from "@/i18n/store"
import type { TranslateFn } from "@/i18n/types"
import { dialog } from "@/stores/dialog"
import { toast } from "@/stores/toast"

import {
  consumeRestoreStatus,
  getBackupRestoreState,
  type BackupInspection,
  type RestoreStatus,
  restartForBackupRestore,
  selectBackup,
  stageBackupRestore,
} from "../../backup-api"
import { openHostFolder } from "../../folders"
import { useProfileBackup } from "../../useProfileBackup"
import { Row, Section } from "../kit"

function announceRestoreOutcome(t: TranslateFn, status: RestoreStatus): void {
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
  if (discardedDescription) {
    toast.warning(t("Settings", "RestoreFailed"), {
      description: t("Settings", discardedDescription),
    })
    return
  }

  toast.warning(t("Settings", "RestoreRolledBack"), {
    description: t("Settings", "RestoreRolledBackDescription"),
  })
}

export function StorageDataPage() {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  const backup = useProfileBackup()
  const [busy, setBusy] = useState<"select" | "restore" | null>(null)
  const [selection, setSelection] = useState<{ grant: string; inspection: BackupInspection } | null>(null)
  const working = backup.busy || busy !== null

  useEffect(() => {
    void consumeRestoreStatus().then((status) => {
      if (!status) return
      announceRestoreOutcome(t, status)
    }).catch((error: unknown) => {
      console.error("[backup] could not read the restore outcome", error)
    })
  }, [t])

  async function chooseBackup() {
    setBusy("select")
    try {
      const result = await selectBackup(t("Settings", "RestorePickerTitle"))
      if (!result.available) {
        toast.warning(t("Settings", "RestorePickerUnavailable"))
        return
      }
      if (!result.cancelled && result.grant && result.inspection)
        setSelection({ grant: result.grant, inspection: result.inspection })
    } catch (error) {
      toast.warning(t("Settings", "RestoreInspectFailed"), { description: describeError(t, error) })
    } finally {
      setBusy(null)
    }
  }

  async function restore() {
    if (!selection) return
    const confirmed = await dialog.confirm({
      title: t("Settings", "RestoreConfirmTitle"),
      message: t("Settings", "RestoreConfirmMessage"),
      confirmLabel: t("Settings", "RestoreAndRestart"),
      cancelLabel: t("Common", "Cancel"),
      destructive: true,
    })
    if (!confirmed) return

    setBusy("restore")
    let operationId: string | null = null
    try {
      const staged = await stageBackupRestore(selection.grant)
      operationId = staged.operationId
      allowNextControlledShutdown()
      await restartForBackupRestore(staged.operationId)
    } catch (error) {
      const stagedOperationId = operationId
      if (!(error instanceof ApiError) && stagedOperationId) {
        try {
          const state = await getBackupRestoreState(stagedOperationId)
          if (state.restartRequested) return
          if (!state.staged) {
            const status = await consumeRestoreStatus()
            if (status) {
              announceRestoreOutcome(t, status)
              setBusy(null)
              setSelection(null)
              return
            }
          }
        } catch {
          if (await waitForControlledShutdownStart()) return
        }
      }
      cancelControlledShutdown()
      setBusy(null)
      toast.warning(t("Settings", "RestoreFailed"), {
        description: error instanceof ApiError ? describeError(t, error) : t("Errors", "RestartUnavailable"),
      })
    }
  }

  async function revealData() {
    const failure = await openHostFolder("data")
    if (failure) toast.warning(t("Settings", failure === "missing" ? "FolderMissing" : "FolderOpenFailed"))
  }

  return (
    <>
      <Section title={t("Settings", "StorageLocationTitle")}>
        <Row label={t("Settings", "DataFolder")} description={t("Settings", "DataFolderDescription")}>
          <Button
            variant="outline"
            size="sm"
            icon={<AppIcon name="folder-open" size={13} strokeWidth={1.7} />}
            onClick={() => void revealData()}
          >
            {t("Settings", "OpenFolder")}
          </Button>
        </Row>
      </Section>

      <Section title={t("Settings", "PortabilityTitle")}>
        <Row label={t("Settings", "BackUpMnemo")} description={t("Settings", "BackUpMnemoDescription")}>
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            icon={
              <AppIcon
                name={backup.busy ? "loader-circle" : "download"}
                size={13}
                strokeWidth={1.7}
                className={backup.busy ? "animate-spin" : undefined}
              />
            }
            onClick={backup.start}
          >
            {backup.label}
          </Button>
        </Row>
        <Row label={t("Settings", "RestoreBackup")} description={t("Settings", "RestoreBackupDescription")}>
          <Button
            variant="outline"
            size="sm"
            disabled={working}
            icon={
              <AppIcon
                name={busy === "select" ? "loader-circle" : "rotate-ccw"}
                size={13}
                strokeWidth={1.7}
                className={busy === "select" ? "animate-spin" : undefined}
              />
            }
            onClick={() => void chooseBackup()}
          >
            {t("Settings", busy === "select" ? "InspectingBackup" : "ChooseBackup")}
          </Button>
        </Row>
      </Section>

      {selection ? (
        <BackupPreviewDialog
          inspection={selection.inspection}
          locale={language === "nb" ? "nb-NO" : language}
          busy={busy === "restore"}
          onClose={() => {
            if (busy === null) setSelection(null)
          }}
          onRestore={() => void restore()}
        />
      ) : null}
    </>
  )
}

function BackupPreviewDialog({
  inspection,
  locale,
  busy,
  onClose,
  onRestore,
}: {
  inspection: BackupInspection
  locale: string
  busy: boolean
  onClose: () => void
  onRestore: () => void
}) {
  const t = useT()
  const counts = inspection.contents
  const rows = [
    ["BackupNotes", counts.notes + counts.noteFolders],
    ["BackupFlashcards", counts.flashcardCards + counts.flashcardDecks],
    ["BackupMindmaps", counts.mindmaps + counts.mindmapFolders],
    ["BackupTrash", counts.trashEntries],
    ["BackupConversations", counts.conversations],
    ["BackupFiles", counts.managedFiles],
  ] as const

  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t("Common", "Close")}
      title={t("Settings", "RestorePreviewTitle")}
      subtitle={t("Settings", "RestorePreviewSubtitle")}
      width={560}
      footer={
        <>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
              {t("Common", "Cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              icon={
                busy ? (
                  <AppIcon name="loader-circle" size={13} strokeWidth={1.7} className="animate-spin" />
                ) : undefined
              }
              onClick={onRestore}
            >
              {t("Settings", busy ? "PreparingRestore" : "RestoreBackup")}
            </Button>
          </div>
        </>
      }
    >
      <div className="min-w-0 flex-1 px-5 pb-5">
        <dl className="rounded-xl bg-canvas-sunken px-4 py-2.5 text-[12.5px]">
          <Metadata
            label={t("Settings", "BackupCreated")}
            value={new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(inspection.createdAtUtc),
            )}
          />
          <Metadata label={t("Settings", "BackupVersion")} value={inspection.createdByAppVersion} />
          <Metadata
            label={t("Settings", "BackupCollection")}
            value={t("Settings", inspection.fromThisCollection ? "BackupThisCollection" : "BackupOtherCollection")}
          />
        </dl>
        <h3 className="mb-1 mt-5 text-[12.5px] font-medium text-ink-3">{t("Settings", "BackupContains")}</h3>
        <div className="divide-y divide-line-soft">
          {rows.map(([key, count]) => (
            <div key={key} className="flex items-center justify-between py-2.5 text-[13px] text-ink">
              <span>{t("Settings", key)}</span>
              <span className="tabular-nums text-ink-3">{count.toLocaleString(locale)}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12.5px] leading-snug text-ink-3">{t("Settings", "BackupExclusions")}</p>
      </div>
    </Modal>
  )
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-1.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className="truncate text-right text-ink">{value}</dd>
    </div>
  )
}
