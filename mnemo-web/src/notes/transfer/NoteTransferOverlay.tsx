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
import { dropRoots, pickedFolder, walkDrop } from "@/components/transfer/folder-walk"
import type { PickedFile } from "@/components/transfer/import-queue"
import { useConflictChoice, useExportFormat, useFormatsErrorToast, useItemPhrase, useResetConflict } from "@/components/transfer/useTransferDialog"
import { useT } from "@/i18n/useT"
import { useFileDropCount } from "@/lib/useFileDrop"
import { notesKey, useNoteFoldersQuery, useNotesQuery } from "@/notes/api"
import { toast } from "@/stores/toast"

import {
  discardNoteUpload,
  runNoteExport,
  runNoteImport,
  uploadNoteTransferFile,
  useNoteTransferFormatsQuery,
} from "./api"
import { useNoteTransfer, type NoteTransferTarget } from "./store"
import { exportFormats, markdownCollisions, queuedFromUpload, readyNoteCount, type QueuedFile } from "./transfer"

const NOTE_FORMAT_CAPTIONS: Record<string, string> = {
  "notes.markdown": "TransferFormatCaptionMarkdown",
  "notes.mnemo": "TransferFormatCaptionMnemo",
}

/** Mounted once in the notes workspace; renders only while the store holds a target. */
export function NoteTransferOverlay() {
  const target = useNoteTransfer((state) => state.target)
  const close = useNoteTransfer((state) => state.close)

  if (!target) return null
  return <NoteTransfer target={target} onClose={close} />
}

function NoteTransfer({ target, onClose }: { target: NoteTransferTarget; onClose: () => void }) {
  const t = useT()
  const nt = (key: string, params?: Record<string, string | number>) => t("Notes", key, params)
  const common = (key: string, params?: Record<string, string | number>) => t("Common", key, params)

  const client = useQueryClient()
  const formats = useNoteTransferFormatsQuery(true)
  const formatList = useMemo(() => formats.data ?? [], [formats.data])

  const [direction, setDirection] = useState<TransferDirection>(target.direction === "export" ? "export" : "import")
  const { conflict, setConflict, onEdit } = useConflictChoice()
  const [busy, setBusy] = useState(false)
  const [walking, setWalking] = useState(false)
  const [reading, setReading] = useState(false)

  const scope = target.scope
  const noteCount = scope?.noteIds.length ?? 0
  const folderIds = scope?.folderIds ?? []
  const hasFolders = folderIds.length > 0
  const destination = target.destination ?? null
  const available = useMemo(() => exportFormats(formatList, noteCount, hasFolders), [formatList, noteCount, hasFolders])

  const [exportFormat, setExportFormat] = useExportFormat(available)

  const formatsReady = formats.isSuccess
  useFormatsErrorToast(formats)

  const imports = useImportQueue({
    upload: uploadNoteTransferFile,
    discard: discardNoteUpload,
    toRow: queuedFromUpload,
    accepts: (name) => isImportable(name, formatList),
    failureNote: (error, name) => describeError(t, error) ?? common("TransferUnreadableFile", { 0: name }),
    onEdit,
  })
  const queue = imports.queue
  const notes = useNotesQuery()
  const folders = useNoteFoldersQuery()
  const inLibrary = packageCollidingKeys(queue, "notes")
  const titleTaken = markdownCollisions(queue, notes.data ?? [], folders.data ?? [], destination?.folderId ?? null)
  const collisions = packageCollisions(queue, "notes") + titleTaken.size
  const colliding = new Set([...inLibrary, ...titleTaken])
  const policy = collisions > 0 ? conflict : "KeepBoth"
  useResetConflict(collisions, setConflict)
  const replacing = policy === "Replace"
  const locked = busy || walking || !formatsReady
  const accepts = (name: string) => isImportable(name, formatList)

  // Confirm waits for the walk. The hint only shows when it takes long enough to notice.
  const addWalked = (walk: Promise<PickedFile[]>) => {
    setWalking(true)
    const hint = window.setTimeout(() => setReading(true), 300)
    void walk.then(imports.add).finally(() => {
      window.clearTimeout(hint)
      setWalking(false)
      setReading(false)
    })
  }
  const dropCount = useFileDropCount(direction === "import", locked, (data) =>
    addWalked(walkDrop(dropRoots(data), accepts)),
  )

  const count = readyNoteCount(queue)
  const itemPhrase = useItemPhrase("Notes")

  const describeRow = (file: QueuedFile) =>
    [
      file.formatName,
      typeof file.noteCount === "number" ? itemPhrase(file.noteCount) : null,
      inLibrary.has(file.key) ? common("TransferInYourLibrary") : titleTaken.has(file.key) ? common("TransferAlreadyExists") : null,
    ]
      .filter(Boolean)
      .join(" · ")

  const doImport = async () => {
    if (busy) return
    setBusy(true)
    const targetFolderId = destination?.folderId ?? null
    const outcome = await imports.importReady((rows) => {
      const paths = rows.flatMap((row) => (row.path ? [[row.uploadId!, row.path] as const] : []))
      return runNoteImport({
        uploadIds: rows.map((row) => row.uploadId!),
        conflictPolicy: policy,
        targetFolderId,
        folderPaths: paths.length > 0 ? Object.fromEntries(paths) : undefined,
      })
    })
    // An import can create folders and notes, so the whole key is stale.
    await client.invalidateQueries({ queryKey: notesKey })
    setBusy(false)
    if (announceImport(t, outcome, (result) => itemPhrase(result.importedNotes))) onClose()
  }

  const selectedExtension = available.find((format) => format.formatId === exportFormat)?.extensions[0] ?? ""
  const named = scope ? (hasFolders ? folderIds.length === 1 : scope.noteIds.length === 1) : false

  const doExport = async () => {
    if (!exportFormat || !scope || scope.noteIds.length === 0 || busy) return

    setBusy(true)
    try {
      const outcome = await runNoteExport({ formatId: exportFormat, noteIds: scope.noteIds, folderIds }, {
        ...exportSaveOptions(common),
        fileName: exportFileName(named ? (scope.fileName ?? scope.label) : null, "notes", selectedExtension),
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
  const emptyScope = !scope || scope.noteIds.length === 0
  const replaceNote =
    replacing && !imports.progress
      ? replaceWarning(t, replaceDiscards(queue, "notes") > 0, titleTaken.size > 0)
      : null
  const confirmEnabled = importing ? canImport(queue) && !busy && !walking : !emptyScope && exportFormat !== null && !busy

  const confirm = () => void (importing ? doImport() : doExport())

  const confirmLabel = !importing
    ? common("TransferExportTab")
    : imports.progress
      ? importingLabel(t, imports.progress)
      : replacing
        ? replaceLabel(t, collisions, readyOutside(queue, colliding))
        : count === null
          ? nt("Import")
          : common("TransferImportButtonFormat", { 0: itemPhrase(count) })

  const picker = useImportPicker({
    extensions: importExtensions(formatList),
    onAdd: imports.add,
    onPickFolder: (files) => addWalked(Promise.resolve(pickedFolder(files, accepts))),
  })
  const options = available.map((format) => ({
    formatId: format.formatId,
    label: format.displayName,
    caption: NOTE_FORMAT_CAPTIONS[format.formatId] ? common(NOTE_FORMAT_CAPTIONS[format.formatId]) : "",
    extension: format.extensions[0] ?? "",
  }))
  const contents = scope ? (named ? scope.label : itemPhrase(scope.noteIds.length)) : ""

  return (
    <TransferShell
      direction={direction}
      both={target.direction === "both"}
      onDirection={setDirection}
      subtitle={importing ? common("TransferToFormat", { 0: destination?.label ?? nt("MyNotes") }) : undefined}
      busy={busy}
      confirmLabel={confirmLabel}
      confirmEnabled={confirmEnabled}
      confirmClassName={importing && replacing ? REPLACE_BUTTON_CLASS : undefined}
      leading={
        importing ? (
          <AddButton disabled={locked} folders onFiles={picker.browse} onFolder={picker.browseFolder} />
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
            warning={(file) => (packageTooNew(file, "notes") ? common("TransferEvidenceTooNew") : null)}
            refused={imports.refused}
            overflow={imports.overflow}
            empty={imports.empty}
            locked={locked}
            dropCount={dropCount}
            reading={reading}
            folders
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
        <p className="py-6 text-center text-body-extra-small text-text-tertiary">{nt("ExportNoNotesMessage")}</p>
      ) : (
        <ExportFormatList
          groupLabel={common("TransferFormatGroupLabel")}
          contents={contents}
          formats={options}
          selected={exportFormat}
          busy={busy}
          unavailable={nt("ExportFormatUnavailableMessage")}
          onSelect={setExportFormat}
        />
      )}
    </TransferShell>
  )
}
