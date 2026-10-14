import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { describeError } from "@/api/error-copy"
import { announceExport, exportFileName, exportSaveOptions } from "@/api/export-file"
import type { ConflictPolicy } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import {
  canImport,
  importExtensions,
  isImportable,
  packageCollidingKeys,
  packageCollisions,
  packageTooNew,
  replaceDiscards,
  replaceLabel,
  replaceWarning,
  readyOutside,
  REPLACE_BUTTON_CLASS,
} from "@/components/transfer/import-queue"
import { ImportPanel } from "@/components/transfer/ImportPanel"
import { ImportStatus, ReplaceNote } from "@/components/transfer/ImportStatus"
import { announceImport, useImportQueue } from "@/components/transfer/useImportQueue"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Segmented } from "@/flashcards/transfer/components/Segmented"
import { useT } from "@/i18n/useT"
import { isMac } from "@/keybinds/chord"
import { useFileDrop } from "@/lib/useFileDrop"
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
import { useMindmapTransfer, type MindmapTransferTarget } from "./store"
import { exportFormats, queuedFromUpload, readyMapCount, type QueuedFile } from "./transfer"

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
  const [conflict, setConflict] = useState<ConflictPolicy>("KeepBoth")
  const [exportFormat, setExportFormat] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      toast.warning(common("ImportFailedTitle"), { description: describeError(t, formats.error) })
    }
    // Keyed on the error alone: `common` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formats.isError])

  const imports = useImportQueue({
    upload: uploadMindmapTransferFile,
    discard: discardMindmapUpload,
    toRow: queuedFromUpload,
    accepts: (name) => isImportable(name, formatList),
    failureNote: (error, name) => describeError(t, error) ?? common("TransferUnreadableFile", { 0: name }),
    onEdit: () => setConflict((policy) => (policy === "Replace" ? "KeepBoth" : policy)),
  })
  const queue = imports.queue
  const collisions = packageCollisions(queue, "mindmaps")
  const colliding = packageCollidingKeys(queue, "mindmaps")
  const policy = collisions > 0 ? conflict : "KeepBoth"
  // Once nothing collides, a choice made for an earlier queue no longer applies.
  useEffect(() => {
    if (collisions === 0) setConflict("KeepBoth")
  }, [collisions])
  const replacing = policy === "Replace"
  const locked = busy || !formatsReady
  const over = useFileDrop(direction === "import", locked, (data) =>
    imports.add(Array.from(data.files, (file) => ({ file, path: "" }))),
  )

  const count = readyMapCount(queue)
  const itemPhrase = (n: number) => {
    const noun = mm(n === 1 ? "TransferNounSingular" : "TransferNounPlural")
    return n === 1
      ? common("TransferOneItemFormat", { 0: noun })
      : common("TransferManyItemsFormat", { 0: n, 1: noun })
  }

  const describeRow = (file: QueuedFile) =>
    [
      file.formatName,
      typeof file.mapCount === "number" ? itemPhrase(file.mapCount) : null,
      colliding.has(file.key) ? common("TransferInYourLibrary") : null,
    ]
      .filter(Boolean)
      .join(" · ")

  const doImport = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    const targetFolderId = target.destination?.folderId ?? null
    const outcome = await imports.importReady((rows) =>
      runMindmapImport({ uploadIds: rows.map((row) => row.uploadId!), conflictPolicy: policy, targetFolderId }),
    )
    // An import can restore maps, folders and templates, so the whole key is stale.
    await client.invalidateQueries({ queryKey: mindmapKey })
    setBusy(false)
    if (announceImport(t, outcome, (result) => itemPhrase(result.importedMaps))) {
      onClose()
    }
  }

  const selectedExtension = available.find((format) => format.formatId === exportFormat)?.extensions[0] ?? ""

  const doExport = async () => {
    if (!exportFormat || !scope || scope.mapIds.length === 0 || busy) {
      return
    }

    setBusy(true)
    try {
      const folderIds = scope.folderIds ?? []
      const named = folderIds.length > 0 ? folderIds.length === 1 : scope.mapIds.length === 1
      const outcome = await runMindmapExport({ formatId: exportFormat, mapIds: scope.mapIds, folderIds }, {
        ...exportSaveOptions(common),
        fileName: exportFileName(named ? scope.label : null, "mindmaps", selectedExtension),
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
        description: describeError(t, error) ?? common("TransferExportFailed"),
      })
    } finally {
      setBusy(false)
    }
  }

  const importing = direction === "import"
  const emptyScope = !scope || scope.mapIds.length === 0
  const replaceNote =
    replacing && !imports.progress ? replaceWarning(t, replaceDiscards(queue, "mindmaps") > 0, false) : null
  const confirmEnabled = importing ? canImport(queue) && !busy : !emptyScope && exportFormat !== null && !busy

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
    : replacing
      ? replaceLabel(t, collisions, readyOutside(queue, colliding))
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
    : scope && scope.mapIds.length === 1 && !scope.folderIds?.length
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
      footer={
        // A wrapping row, so the replace note gets its own line.
        <div className="flex w-full flex-wrap items-center gap-3">
          {importing && replaceNote ? <ReplaceNote text={replaceNote} /> : null}
          {importing ? (
            <ImportStatus
              summary={summary}
              progress={imports.progress}
              collisions={collisions}
              policy={policy}
              onPolicy={setConflict}
              disabled={busy}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">{summary}</span>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("Common", "Cancel")}
          </Button>
          <Button
            size="sm"
            className={importing && replacing ? `gap-2 ${REPLACE_BUTTON_CLASS}` : "gap-2"}
            disabled={!confirmEnabled}
            onClick={confirm}
          >
            {busy ? <AppIcon name="loader-circle" size={13} className="animate-spin" /> : null}
            {confirmLabel}
            <span className="font-mono text-[10.5px] opacity-60">{SHORTCUT_HINT}</span>
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4">
        {importing ? (
          <ImportPanel
            queue={queue}
            extensions={importExtensions(formatList)}
            describe={describeRow}
            warning={(file) => (packageTooNew(file, "mindmaps") ? common("TransferEvidenceTooNew") : null)}
            refused={imports.refused}
            overflow={imports.overflow}
            destination={
              target.destination ? mm("TransferImportDestinationFormat", { 0: target.destination.label }) : undefined
            }
            locked={locked}
            dropping={over}
            onAdd={imports.add}
            onRemove={(key) => !busy && imports.remove(key)}
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
