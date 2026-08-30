import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { ApiError } from "@/api/client"
import { announceExport, exportFileName, exportSaveOptions } from "@/api/export-file"
import type { ConflictPolicy } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Segmented } from "@/flashcards/transfer/components/Segmented"
import { useT } from "@/i18n/useT"
import { isMac } from "@/keybinds/chord"
import { toast } from "@/stores/toast"

import { mindmapKey } from "../api"
import {
  discardMindmapUpload,
  runMindmapExport,
  runMindmapImport,
  uploadMindmapTransferFile,
  useMindmapTransferFormatsQuery,
} from "./api"
import { MindmapExportPanel } from "./components/MindmapExportPanel"
import { MindmapImportPanel } from "./components/MindmapImportPanel"
import { useMindmapTransfer, type MindmapTransferTarget } from "./store"
import {
  canImport as queueCanImport,
  exportFormats,
  isImportable,
  MAX_FILES,
  queuedFromUpload,
  readyMapCount,
  readyUploadIds,
  replaceNeedsConfirmation,
  type QueuedFile,
} from "./transfer"

const SHORTCUT_HINT = isMac ? "⌘⏎" : "Ctrl+⏎"

/** Mounted once in the library; renders only while the store holds a target. */
export function MindmapTransferOverlay() {
  const target = useMindmapTransfer((state) => state.target)
  const close = useMindmapTransfer((state) => state.close)

  if (!target) {
    return null
  }
  return <MindmapTransfer target={target} onClose={close} />
}

type Direction = "import" | "export"

function MindmapTransfer({ target, onClose }: { target: MindmapTransferTarget; onClose: () => void }) {
  const t = useT()
  const mm = (key: string, params?: Record<string, string | number>) => t("Mindmap", key, params)
  const common = (key: string, params?: Record<string, string | number>) => t("Common", key, params)

  const client = useQueryClient()
  const formats = useMindmapTransferFormatsQuery(true)
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
  const available = useMemo(() => exportFormats(formatList), [formatList])

  // Default to the first offered format once the list arrives, and correct a selection the format
  // list no longer contains rather than leaving Confirm pointing at nothing.
  useEffect(() => {
    if (available.length === 0) {
      return
    }
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
      for (const controller of inFlight.values()) {
        controller.abort()
      }
      for (const file of queueRef.current) {
        if (file.uploadId) {
          void discardMindmapUpload(file.uploadId)
        }
      }
    }
  }, [])

  const addFiles = (files: File[]) => {
    if (busy || !formatsReady) {
      return
    }

    const refused: string[] = []
    const accepted: File[] = []
    for (const file of files) {
      if (isImportable(file.name, formatList)) {
        accepted.push(file)
      } else {
        refused.push(file.name)
      }
    }

    setRejected(refused)
    if (accepted.length > 0) {
      setReplaceConfirmed(false)
    }

    for (const file of accepted) {
      if (queueRef.current.length >= MAX_FILES) {
        break
      }
      const duplicate = queueRef.current.some((queued) => queued.name === file.name && queued.sizeBytes === file.size)
      if (duplicate) {
        continue
      }

      const key = crypto.randomUUID()
      const placeholder: QueuedFile = { key, name: file.name, sizeBytes: file.size, status: "uploading" }
      queueRef.current = [...queueRef.current, placeholder]
      setQueue((current) => [...current, placeholder])

      const controller = new AbortController()
      uploads.current.set(key, controller)

      void uploadMindmapTransferFile(file, controller.signal)
        .then((upload) => {
          uploads.current.delete(key)
          // The row can be gone by now, removed or the whole dialog closed, while its bytes were
          // still going up. The server has them and nobody will ask again, so they go straight back
          // instead of waiting on a sweep that only runs when somebody else uploads.
          if (unmounted.current || !queueRef.current.some((queued) => queued.key === key)) {
            void discardMindmapUpload(upload.uploadId)
            return
          }
          const settled = queuedFromUpload(key, upload)
          queueRef.current = queueRef.current.map((queued) => (queued.key === key ? settled : queued))
          setQueue((current) => current.map((queued) => (queued.key === key ? settled : queued)))
        })
        .catch((error: unknown) => {
          uploads.current.delete(key)
          if (controller.signal.aborted) {
            return
          }
          const failed: Partial<QueuedFile> = {
            status: "rejected",
            notes: [{ text: error instanceof Error ? error.message : common("TransferUnreadableFile", { 0: file.name }) }],
          }
          queueRef.current = queueRef.current.map((queued) => (queued.key === key ? { ...queued, ...failed } : queued))
          setQueue((current) => current.map((queued) => (queued.key === key ? { ...queued, ...failed } : queued)))
        })
    }
  }

  const removeFile = (key: string) => {
    // Withheld mid-import: the id is inside a request the server is working through, and handing it
    // back now would have the import report the file as missing instead of importing it.
    if (busy) {
      return
    }

    const file = queueRef.current.find((queued) => queued.key === key)
    uploads.current.get(key)?.abort()
    uploads.current.delete(key)
    if (file?.uploadId) {
      void discardMindmapUpload(file.uploadId)
    }

    queueRef.current = queueRef.current.filter((queued) => queued.key !== key)
    setQueue((current) => current.filter((queued) => queued.key !== key))
    setReplaceConfirmed(false)
  }

  const count = readyMapCount(queue)
  const itemPhrase = (n: number) => {
    const noun = mm(n === 1 ? "TransferNounSingular" : "TransferNounPlural")
    return n === 1
      ? common("TransferOneItemFormat", { 0: noun })
      : common("TransferManyItemsFormat", { 0: n, 1: noun })
  }

  const doImport = async () => {
    const uploadIds = readyUploadIds(queue)
    if (uploadIds.length === 0 || busy) {
      return
    }

    setBusy(true)
    try {
      const result = await runMindmapImport({ uploadIds, conflictPolicy: conflict })
      queueRef.current = []
      setQueue([])
      // An import can restore maps, folders and style templates at once; everything under the
      // mindmap key is potentially stale, and picking through it would be guesswork.
      await client.invalidateQueries({ queryKey: mindmapKey })

      if (result.succeededFiles === 0) {
        toast.warning(common("ImportFailedTitle"), { description: result.errors.join("\n") })
      } else if (result.failedFiles > 0) {
        toast.warning(common("ImportCompleteTitle"), {
          description: common("TransferImportPartialFormat", {
            0: itemPhrase(result.importedMaps),
            1: result.errors.join("\n"),
          }),
        })
      } else {
        toast.success(common("ImportCompleteTitle"), {
          description: common("TransferImportFinishedFormat", { 0: itemPhrase(result.importedMaps) }),
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
        await client.invalidateQueries({ queryKey: mindmapKey })
      }
    } finally {
      setBusy(false)
    }
  }

  const selectedExtension = available.find((format) => format.formatId === exportFormat)?.extensions[0] ?? ""

  const doExport = async () => {
    if (!exportFormat || !scope || scope.mapIds.length === 0 || busy) {
      return
    }

    setBusy(true)
    try {
      const outcome = await runMindmapExport({ formatId: exportFormat, mapIds: scope.mapIds }, {
        ...exportSaveOptions(common),
        fileName: exportFileName(scope.mapIds.length === 1 ? scope.label : null, "mindmaps", selectedExtension),
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
  const emptyScope = !scope || scope.mapIds.length === 0
  const awaitingReplaceConsent = replaceNeedsConfirmation(queue, conflict) && !replaceConfirmed
  const confirmEnabled = importing
    ? queueCanImport(queue) && !busy && !awaitingReplaceConsent
    : !emptyScope && exportFormat !== null && !busy

  const confirm = () => void (importing ? doImport() : doExport())

  // At document level, like the shell's own Escape handling: the dialog is not focused when it opens
  // from a menu item, so a handler on its surface would never see the press.
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  useEffect(() => {
    if (!confirmEnabled) {
      return
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        event.stopPropagation()
        confirmRef.current()
      }
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [confirmEnabled])

  const confirmLabel = !importing
    ? common("TransferExportButtonFormat", { 0: selectedExtension })
    : count === null
      ? mm("Import")
      : common("TransferImportButtonFormat", { 0: itemPhrase(count) })

  const fileSummary =
    queue.length === 1 ? common("TransferOneFile") : common("TransferManyFilesFormat", { 0: queue.length })
  const summary = importing
    ? [fileSummary, count === null ? null : itemPhrase(count)].filter(Boolean).join(" · ")
    : common("TransferOneFile")

  const title = importing
    ? mm("TransferImportTitle")
    : scope && scope.mapIds.length === 1
      ? mm("TransferExportSingleTitle")
      : mm("TransferExportTitle")

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) {
          onClose()
        }
      }}
      title={title}
      subtitle={importing ? undefined : scope?.label}
      closeLabel={t("Common", "Close")}
      width={520}
      headerRight={
        target.direction === "both" ? (
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
        ) : undefined
      }
      // The whole dialog takes drops, not just the dropzone: the dropzone is replaced by the file
      // list after the first file, and dragging a second one onto that list should still work.
      surface={{
        onDragOver: (event) => event.preventDefault(),
        onDrop: (event) => {
          event.preventDefault()
          if (importing && !busy && formatsReady) {
            addFiles(Array.from(event.dataTransfer.files))
          }
        },
      }}
      footer={
        <>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">{summary}</span>
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("Common", "Cancel")}
          </Button>
          <Button size="sm" className="gap-2" disabled={!confirmEnabled} onClick={confirm}>
            {confirmLabel}
            <span className="font-mono text-[10.5px] opacity-60">{SHORTCUT_HINT}</span>
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4">
        {importing ? (
          <MindmapImportPanel
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
          <p className="py-6 text-center text-[12px] text-ink-3">{mm("ExportNoMapsMessage")}</p>
        ) : (
          <MindmapExportPanel
            formats={available}
            selected={exportFormat}
            scope={scope}
            busy={busy}
            onSelect={setExportFormat}
          />
        )}
      </div>
    </Modal>
  )
}
