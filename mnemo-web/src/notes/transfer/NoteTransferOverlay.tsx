import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Dialog } from "radix-ui"

import { ApiError } from "@/api/client"
import { announceExport, exportFileName, exportSaveOptions } from "@/api/export-file"
import type { ConflictPolicy } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Segmented } from "@/flashcards/transfer/components/Segmented"
import { useT } from "@/i18n/useT"
import { isMac } from "@/keybinds/chord"
import { notesKey } from "@/notes/api"
import { toast } from "@/stores/toast"

import {
  discardNoteUpload,
  runNoteExport,
  runNoteImport,
  uploadNoteTransferFile,
  useNoteTransferFormatsQuery,
} from "./api"
import { NoteExportPanel } from "./components/NoteExportPanel"
import { NoteImportPanel } from "./components/NoteImportPanel"
import { useNoteTransfer, type NoteTransferTarget } from "./store"
import {
  canImport as queueCanImport,
  exportFormats,
  isImportable,
  MAX_FILES,
  queuedFromUpload,
  readyNoteCount,
  readyUploadIds,
  replaceNeedsConfirmation,
  type QueuedFile,
} from "./transfer"

const SHORTCUT_HINT = isMac ? "⌘⏎" : "Ctrl+⏎"

/** Mounted once in the notes workspace; renders only while the store holds a target. */
export function NoteTransferOverlay() {
  const target = useNoteTransfer((state) => state.target)
  const close = useNoteTransfer((state) => state.close)

  if (!target) return null
  return <NoteTransfer target={target} onClose={close} />
}

type Direction = "import" | "export"

function NoteTransfer({ target, onClose }: { target: NoteTransferTarget; onClose: () => void }) {
  const t = useT()
  const nt = (key: string, params?: Record<string, string | number>) => t("Notes", key, params)
  const common = (key: string, params?: Record<string, string | number>) => t("Common", key, params)

  const client = useQueryClient()
  const formats = useNoteTransferFormatsQuery(true)
  const formatList = useMemo(() => formats.data ?? [], [formats.data])

  const [direction, setDirection] = useState<Direction>(target.direction === "export" ? "export" : "import")
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const [conflict, setConflict] = useState<ConflictPolicy>("KeepBoth")
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [exportFormat, setExportFormat] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Consent applies only to the current queue and policy.
  const changeConflict = (policy: ConflictPolicy) => {
    setConflict(policy)
    setReplaceConfirmed(false)
  }

  const scope = target.scope
  const noteCount = scope?.noteIds.length ?? 0
  const available = useMemo(() => exportFormats(formatList, noteCount), [formatList, noteCount])

  // Default to the first offered format once the list arrives, and correct a selection the format
  // list no longer contains rather than leaving Confirm pointing at nothing.
  useEffect(() => {
    if (available.length === 0) return
    setExportFormat((current) =>
      current && available.some((format) => format.formatId === current) ? current : available[0].formatId,
    )
  }, [available])

  const formatsReady = formats.isSuccess
  useEffect(() => {
    if (formats.isError) {
      toast.warning(common("ImportFailedTitle"), { description: formats.error.message })
    }
    // Keyed on the error alone: `common` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formats.isError])

  // The cleanup below runs once, so it reads the queue through a ref rather than the closure it was
  // created in, which would still be holding the empty first render.
  const queueRef = useRef(queue)
  queueRef.current = queue

  /** One controller per upload, so cancelling a row cannot take the other rows down with it. */
  const uploads = useRef(new Map<string, AbortController>())
  const unmounted = useRef(false)

  useEffect(() => {
    // Cleared on the way in, not just set on the way out: an effect that only ever sets this true
    // stays true through a remount, and every upload after it would resolve straight into the
    // "nobody wants these bytes" branch and discard itself.
    unmounted.current = false
    const inFlight = uploads.current
    return () => {
      unmounted.current = true
      for (const controller of inFlight.values()) controller.abort()
      for (const file of queueRef.current) {
        if (file.uploadId) void discardNoteUpload(file.uploadId)
      }
    }
  }, [])

  const addFiles = (files: File[]) => {
    if (busy || !formatsReady) return

    const refused: string[] = []
    const accepted: File[] = []
    for (const file of files) {
      if (isImportable(file.name, formatList)) accepted.push(file)
      else refused.push(file.name)
    }

    setRejected(refused)
    if (accepted.length > 0) setReplaceConfirmed(false)

    for (const file of accepted) {
      if (queueRef.current.length >= MAX_FILES) break
      const duplicate = queueRef.current.some(
        (queued) => queued.name === file.name && queued.sizeBytes === file.size,
      )
      if (duplicate) continue

      const key = crypto.randomUUID()
      const placeholder: QueuedFile = { key, name: file.name, sizeBytes: file.size, status: "uploading" }
      queueRef.current = [...queueRef.current, placeholder]
      setQueue((current) => [...current, placeholder])

      const controller = new AbortController()
      uploads.current.set(key, controller)

      void uploadNoteTransferFile(file, controller.signal)
        .then((upload) => {
          uploads.current.delete(key)
          // The row can be gone by now, removed or the whole dialog closed, while its bytes were
          // still going up. The server has them and nobody will ask again, so they go straight back
          // instead of waiting on a sweep that only runs when somebody else uploads.
          if (unmounted.current || !queueRef.current.some((queued) => queued.key === key)) {
            void discardNoteUpload(upload.uploadId)
            return
          }
          const settled = queuedFromUpload(key, upload)
          queueRef.current = queueRef.current.map((queued) => (queued.key === key ? settled : queued))
          setQueue((current) => current.map((queued) => (queued.key === key ? settled : queued)))
        })
        .catch((error: unknown) => {
          uploads.current.delete(key)
          if (controller.signal.aborted) return
          const failed: Partial<QueuedFile> = {
            status: "rejected",
            notes: [{ text: error instanceof Error ? error.message : common("TransferUnreadableFile", { 0: file.name }) }],
          }
          queueRef.current = queueRef.current.map((queued) =>
            queued.key === key ? { ...queued, ...failed } : queued,
          )
          setQueue((current) => current.map((queued) => (queued.key === key ? { ...queued, ...failed } : queued)))
        })
    }
  }

  const removeFile = (key: string) => {
    // Withheld mid-import: the id is inside a request the server is working through, and handing it
    // back now would have the import report the file as missing instead of importing it.
    if (busy) return

    const file = queueRef.current.find((queued) => queued.key === key)
    uploads.current.get(key)?.abort()
    uploads.current.delete(key)
    if (file?.uploadId) void discardNoteUpload(file.uploadId)

    queueRef.current = queueRef.current.filter((queued) => queued.key !== key)
    setQueue((current) => current.filter((queued) => queued.key !== key))
    setReplaceConfirmed(false)
  }

  const count = readyNoteCount(queue)
  const itemPhrase = (n: number) => {
    const noun = nt(n === 1 ? "TransferNounSingular" : "TransferNounPlural")
    return n === 1
      ? common("TransferOneItemFormat", { 0: noun })
      : common("TransferManyItemsFormat", { 0: n, 1: noun })
  }

  const doImport = async () => {
    const uploadIds = readyUploadIds(queue)
    if (uploadIds.length === 0 || busy) return

    setBusy(true)
    try {
      const result = await runNoteImport({ uploadIds, conflictPolicy: conflict })
      queueRef.current = []
      setQueue([])
      // An import can create folders and notes at once; everything under the notes key is
      // potentially stale, and picking through it would be guesswork.
      await client.invalidateQueries({ queryKey: notesKey })

      if (result.succeededFiles === 0) {
        toast.warning(common("ImportFailedTitle"), { description: result.errors.join("\n") })
      } else if (result.failedFiles > 0) {
        toast.warning(common("ImportCompleteTitle"), {
          description: common("TransferImportPartialFormat", {
            0: itemPhrase(result.importedNotes),
            1: result.errors.join("\n"),
          }),
        })
      } else {
        toast.success(common("ImportCompleteTitle"), {
          description: common("TransferImportFinishedFormat", { 0: itemPhrase(result.importedNotes) }),
        })
      }
      onClose()
    } catch (error) {
      toast.warning(common("ImportFailedTitle"), {
        description: error instanceof Error ? error.message : undefined,
      })
      // Only a rejected request leaves the staged files untouched; every 400 here is refused before
      // the server opens anything. Any other failure may have consumed them part-way, so the queue
      // is dropped rather than left offering a Confirm that would report each file as missing.
      if (!(error instanceof ApiError && error.status === 400)) {
        queueRef.current = []
        setQueue([])
        await client.invalidateQueries({ queryKey: notesKey })
      }
    } finally {
      setBusy(false)
    }
  }

  const selectedExtension = available.find((format) => format.formatId === exportFormat)?.extensions[0] ?? ""

  const doExport = async () => {
    if (!exportFormat || !scope || scope.noteIds.length === 0 || busy) return

    setBusy(true)
    try {
      const outcome = await runNoteExport({ formatId: exportFormat, noteIds: scope.noteIds }, {
        ...exportSaveOptions(common),
        fileName: exportFileName(scope.noteIds.length === 1 ? scope.label : null, "notes", selectedExtension),
      })
      const told = announceExport(outcome, {
        title: common("ExportCompleteTitle"),
        downloaded: common("TransferExportFinished"),
      })
      // A dismissed chooser leaves the dialog where it was, with the format still picked. Closing
      // it would read as "done" for a file that does not exist.
      if (!told) return

      onClose()
    } catch (error) {
      toast.warning(common("ExportFailedTitle"), {
        description: error instanceof Error ? error.message : common("TransferExportFailed"),
      })
    } finally {
      setBusy(false)
    }
  }

  const importing = direction === "import"
  const emptyScope = !scope || scope.noteIds.length === 0
  const awaitingReplaceConsent = replaceNeedsConfirmation(queue, conflict) && !replaceConfirmed
  const confirmEnabled = importing
    ? queueCanImport(queue) && !busy && !awaitingReplaceConsent
    : !emptyScope && exportFormat !== null && !busy

  const confirm = () => void (importing ? doImport() : doExport())

  const confirmLabel = !importing
    ? common("TransferExportButtonFormat", { 0: selectedExtension })
    : count === null
      ? nt("Import")
      : common("TransferImportButtonFormat", { 0: itemPhrase(count) })

  const fileSummary =
    queue.length === 1 ? common("TransferOneFile") : common("TransferManyFilesFormat", { 0: queue.length })
  const summary = importing
    ? [fileSummary, count === null ? null : itemPhrase(count)].filter(Boolean).join(" · ")
    : common("TransferOneFile")

  const title = importing
    ? nt("TransferImportTitle")
    : scope && scope.noteIds.length === 1
      ? nt("TransferExportNoteTitle")
      : nt("TransferExportTitle")

  return (
    <Dialog.Root open onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if ((isMac ? event.metaKey : event.ctrlKey) && event.key === "Enter" && confirmEnabled) {
              event.preventDefault()
              confirm()
            }
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[520px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-[var(--overlay-background)] shadow-[0_16px_40px_0_rgba(0,0,0,0.22)] focus:outline-none"
        >
          <div className="flex items-center gap-3 border-b border-divider-subtle px-5 py-3.5">
            {target.direction === "both" ? null : (
              <AppIcon
                name={importing ? "common/download" : "common/upload"}
                size={16}
                className="shrink-0 text-brand"
              />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <Dialog.Title className="text-body-small font-semibold text-text-primary">{title}</Dialog.Title>
              {!importing && scope ? (
                <div className="truncate text-body-extra-small text-text-tertiary">{scope.label}</div>
              ) : null}
            </div>

            {target.direction === "both" ? (
              <Segmented
                className="w-[176px] shrink-0"
                label={`${common("TransferImportTab")} / ${common("TransferExportTab")}`}
                value={direction}
                onChange={setDirection}
                options={[
                  { value: "import", label: common("TransferImportTab"), icon: "common/download", disabled: busy },
                  { value: "export", label: common("TransferExportTab"), icon: "common/upload", disabled: busy },
                ]}
              />
            ) : null}

            <Dialog.Close asChild>
              <IconButton icon="common/x" iconSize={14} label={t("Common", "Close")} disabled={busy} />
            </Dialog.Close>
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-[18px]">
            {importing ? (
              <NoteImportPanel
                queue={queue}
                formats={formatList}
                rejected={rejected}
                conflict={conflict}
                busy={busy}
                ready={formatsReady}
                replaceConfirmed={replaceConfirmed}
                onAddFiles={addFiles}
                onRemove={removeFile}
                onConflictChange={changeConflict}
                onReplaceConfirmedChange={setReplaceConfirmed}
              />
            ) : emptyScope ? (
              <p className="py-6 text-center text-body-extra-small text-text-tertiary">
                {nt("ExportNoNotesMessage")}
              </p>
            ) : (
              <NoteExportPanel
                formats={available}
                selected={exportFormat}
                scope={scope}
                busy={busy}
                onSelect={setExportFormat}
              />
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-divider-subtle bg-surface-subtle px-5 py-3.5">
            <span className="min-w-0 flex-1 truncate text-caption text-text-tertiary">{summary}</span>
            <Button variant="outline" className="h-[34px] px-4" disabled={busy} onClick={onClose}>
              {t("Common", "Cancel")}
            </Button>
            <Button className="h-[34px] gap-2 px-[18px]" disabled={!confirmEnabled} onClick={confirm}>
              {confirmLabel}
              <span className="font-mono text-caption opacity-60">{SHORTCUT_HINT}</span>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
