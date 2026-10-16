import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { describeError } from "@/api/error-copy"
import { announceExport, exportFileName, exportSaveOptions } from "@/api/export-file"
import {
  canImport,
  importExtensions,
  importingLabel,
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
import { ConflictRow } from "@/components/transfer/ImportStatus"
import { ExportFormatList } from "@/components/transfer/ExportFormatList"
import { TransferShell, type TransferDirection } from "@/components/transfer/TransferShell"
import { AddButton } from "@/components/transfer/AddButton"
import { useImportPicker } from "@/components/transfer/useImportPicker"
import { announceImport, useImportQueue } from "@/components/transfer/useImportQueue"
import { useConflictChoice, useExportFormat, useFormatsErrorToast, useItemPhrase, useResetConflict } from "@/components/transfer/useTransferDialog"
import { useT } from "@/i18n/useT"
import { useFileDropCount } from "@/lib/useFileDrop"
import { toast } from "@/stores/toast"

import { mindmapKey } from "../api"
import {
  discardMindmapUpload,
  runMindmapExport,
  runMindmapImport,
  uploadMindmapTransferFile,
  useMindmapTransferFormatsQuery,
} from "./api"
import { useMindmapTransfer, type MindmapTransferTarget } from "./store"
import { exportFormats, queuedFromUpload, readyMapCount, type QueuedFile } from "./transfer"

const MAP_FORMAT_CAPTIONS: Record<string, string> = {
  "mindmaps.mnemo": "TransferFormatCaptionMnemo",
}

/** Mounted once in the library; renders only while the store holds a target. */
export function MindmapTransferOverlay() {
  const target = useMindmapTransfer((state) => state.target)
  const close = useMindmapTransfer((state) => state.close)

  if (!target) {
    return null
  }
  return <MindmapTransfer target={target} onClose={close} />
}

function MindmapTransfer({ target, onClose }: { target: MindmapTransferTarget; onClose: () => void }) {
  const t = useT()
  const mm = (key: string, params?: Record<string, string | number>) => t("Mindmap", key, params)
  const common = (key: string, params?: Record<string, string | number>) => t("Common", key, params)

  const client = useQueryClient()
  const formats = useMindmapTransferFormatsQuery(true)
  const formatList = useMemo(() => formats.data ?? [], [formats.data])

  const [direction, setDirection] = useState<TransferDirection>(target.direction === "export" ? "export" : "import")
  const { conflict, setConflict, onEdit } = useConflictChoice()
  const [busy, setBusy] = useState(false)

  const scope = target.scope
  const available = useMemo(() => exportFormats(formatList), [formatList])

  const [exportFormat, setExportFormat] = useExportFormat(available)

  const formatsReady = formats.isSuccess
  useFormatsErrorToast(formats)

  const imports = useImportQueue({
    upload: uploadMindmapTransferFile,
    discard: discardMindmapUpload,
    toRow: queuedFromUpload,
    accepts: (name) => isImportable(name, formatList),
    failureNote: (error, name) => describeError(t, error) ?? common("TransferUnreadableFile", { 0: name }),
    onEdit,
  })
  const queue = imports.queue
  const collisions = packageCollisions(queue, "mindmaps")
  const colliding = packageCollidingKeys(queue, "mindmaps")
  const policy = collisions > 0 ? conflict : "KeepBoth"
  useResetConflict(collisions, setConflict)
  const replacing = policy === "Replace"
  const locked = busy || !formatsReady
  const dropCount = useFileDropCount(direction === "import", locked, (data) =>
    imports.add(Array.from(data.files, (file) => ({ file, path: "" }))),
  )

  const count = readyMapCount(queue)
  const itemPhrase = useItemPhrase("Mindmap")

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
  const folderIds = scope?.folderIds ?? []
  const named = scope ? (folderIds.length > 0 ? folderIds.length === 1 : scope.mapIds.length === 1) : false

  const doExport = async () => {
    if (!exportFormat || !scope || scope.mapIds.length === 0 || busy) {
      return
    }

    setBusy(true)
    try {
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

  const confirmLabel = !importing
    ? common("TransferExportTab")
    : imports.progress
      ? importingLabel(t, imports.progress)
      : replacing
        ? replaceLabel(t, collisions, readyOutside(queue, colliding))
        : count === null
          ? mm("Import")
          : common("TransferImportButtonFormat", { 0: itemPhrase(count) })

  const picker = useImportPicker({ extensions: importExtensions(formatList), onAdd: imports.add })
  const options = available.map((format) => ({
    formatId: format.formatId,
    label: format.displayName,
    caption: MAP_FORMAT_CAPTIONS[format.formatId] ? common(MAP_FORMAT_CAPTIONS[format.formatId]) : "",
    extension: format.extensions[0] ?? "",
  }))
  const contents = scope ? (named ? scope.label : itemPhrase(scope.mapIds.length)) : ""

  return (
    <TransferShell
      direction={direction}
      both={target.direction === "both"}
      onDirection={setDirection}
      subtitle={importing && target.destination ? common("TransferToFormat", { 0: target.destination.label }) : undefined}
      busy={busy}
      confirmLabel={confirmLabel}
      confirmEnabled={confirmEnabled}
      confirmClassName={importing && replacing ? REPLACE_BUTTON_CLASS : undefined}
      leading={
        importing && queue.length > 0 ? (
          <AddButton disabled={locked} folders={false} onFiles={picker.browse} onFolder={picker.browseFolder} />
        ) : null
      }
      onConfirm={confirm}
      onClose={onClose}
    >
      {importing ? (
        <>
          {picker.inputs}
          <ImportPanel
            queue={queue}
            describe={describeRow}
            warning={(file) => (packageTooNew(file, "mindmaps") ? common("TransferEvidenceTooNew") : null)}
            refused={imports.refused}
            overflow={imports.overflow}
            locked={locked}
            dropCount={dropCount}
            onBrowse={picker.browse}
            onRemove={(key) => !busy && imports.remove(key)}
            conflict={
              collisions > 0 && !imports.progress ? (
                <ConflictRow policy={policy} onPolicy={setConflict} disabled={busy} note={replaceNote} />
              ) : null
            }
          />
        </>
      ) : emptyScope ? (
        <p className="py-6 text-center text-[12px] text-ink-3">{mm("ExportNoMapsMessage")}</p>
      ) : (
        <ExportFormatList
          groupLabel={common("TransferFormatGroupLabel")}
          contents={contents}
          formats={options}
          selected={exportFormat}
          busy={busy}
          unavailable={mm("ExportFormatUnavailableMessage")}
          onSelect={setExportFormat}
        />
      )}
    </TransferShell>
  )
}
