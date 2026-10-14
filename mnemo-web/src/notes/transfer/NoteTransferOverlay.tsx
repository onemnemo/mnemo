import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Dialog } from "radix-ui"

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
import { dropRoots, pickedFolder, walkDrop } from "@/components/transfer/folder-walk"
import type { PickedFile } from "@/components/transfer/import-queue"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Segmented } from "@/flashcards/transfer/components/Segmented"
import { useT } from "@/i18n/useT"
import { isMac } from "@/keybinds/chord"
import { useFileDrop } from "@/lib/useFileDrop"
import { cn } from "@/lib/utils"
import { notesKey, useNoteFoldersQuery, useNotesQuery } from "@/notes/api"
import { toast } from "@/stores/toast"

import {
  discardNoteUpload,
  runNoteExport,
  runNoteImport,
  uploadNoteTransferFile,
  useNoteTransferFormatsQuery,
} from "./api"
import { NoteExportPanel } from "./components/NoteExportPanel"
import { useNoteTransfer, type NoteTransferTarget } from "./store"
import { exportFormats, markdownCollisions, queuedFromUpload, readyNoteCount, type QueuedFile } from "./transfer"

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
  const [conflict, setConflict] = useState<ConflictPolicy>("KeepBoth")
  const [exportFormat, setExportFormat] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [walking, setWalking] = useState(false)
  const [reading, setReading] = useState(false)

  const scope = target.scope
  const noteCount = scope?.noteIds.length ?? 0
  const folderIds = scope?.folderIds ?? []
  const hasFolders = folderIds.length > 0
  const destination = target.destination ?? null
  const available = useMemo(() => exportFormats(formatList, noteCount, hasFolders), [formatList, noteCount, hasFolders])

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
      toast.warning(common("ImportFailedTitle"), { description: describeError(t, formats.error) })
    }
    // Keyed on the error alone: `common` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formats.isError])

  const imports = useImportQueue({
    upload: uploadNoteTransferFile,
    discard: discardNoteUpload,
    toRow: queuedFromUpload,
    accepts: (name) => isImportable(name, formatList),
    failureNote: (error, name) => describeError(t, error) ?? common("TransferUnreadableFile", { 0: name }),
    onEdit: () => setConflict((policy) => (policy === "Replace" ? "KeepBoth" : policy)),
  })
  const queue = imports.queue
  const notes = useNotesQuery()
  const folders = useNoteFoldersQuery()
  const inLibrary = packageCollidingKeys(queue, "notes")
  const titleTaken = markdownCollisions(queue, notes.data ?? [], folders.data ?? [], destination?.folderId ?? null)
  const collisions = packageCollisions(queue, "notes") + titleTaken.size
  const colliding = new Set([...inLibrary, ...titleTaken])
  const policy = collisions > 0 ? conflict : "KeepBoth"
  // Once nothing collides, a choice made for an earlier queue no longer applies.
  useEffect(() => {
    if (collisions === 0) setConflict("KeepBoth")
  }, [collisions])
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
  const over = useFileDrop(direction === "import", locked, (data) => addWalked(walkDrop(dropRoots(data), accepts)))

  const count = readyNoteCount(queue)
  const itemPhrase = (n: number) => {
    const noun = nt(n === 1 ? "TransferNounSingular" : "TransferNounPlural")
    return n === 1
      ? common("TransferOneItemFormat", { 0: noun })
      : common("TransferManyItemsFormat", { 0: n, 1: noun })
  }

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

  const doExport = async () => {
    if (!exportFormat || !scope || scope.noteIds.length === 0 || busy) return

    setBusy(true)
    try {
      const named = hasFolders ? folderIds.length === 1 : scope.noteIds.length === 1
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
    ? common("TransferExportButtonFormat", { 0: selectedExtension })
    : replacing
      ? replaceLabel(t, collisions, readyOutside(queue, colliding))
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
    : scope && scope.noteIds.length === 1 && !hasFolders
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
                className="shrink-0 text-ink-icon"
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
              <ImportPanel
                queue={queue}
                extensions={importExtensions(formatList)}
                describe={describeRow}
                warning={(file) => (packageTooNew(file, "notes") ? common("TransferEvidenceTooNew") : null)}
                refused={imports.refused}
                overflow={imports.overflow}
                empty={imports.empty}
                destination={nt("TransferImportDestinationFormat", { 0: destination?.label ?? nt("MyNotes") })}
                locked={locked}
                dropping={over}
                reading={reading}
                onAdd={imports.add}
                onRemove={(key) => !busy && imports.remove(key)}
                onPickFolder={(files) => addWalked(Promise.resolve(pickedFolder(files, accepts)))}
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

          <div className="flex flex-wrap items-center gap-3 border-t border-divider-subtle bg-surface-subtle px-5 py-3.5">
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
              <span className="min-w-0 flex-1 truncate text-caption text-text-tertiary">{summary}</span>
            )}
            <Button variant="outline" className="h-[34px] px-4" disabled={busy} onClick={onClose}>
              {t("Common", "Cancel")}
            </Button>
            <Button
              className={cn("h-[34px] gap-2 px-[18px]", importing && replacing && REPLACE_BUTTON_CLASS)}
              disabled={!confirmEnabled}
              onClick={confirm}
            >
              {busy ? <AppIcon name="loader-circle" size={13} className="animate-spin" /> : null}
              {confirmLabel}
              <span className="font-mono text-caption opacity-60">{SHORTCUT_HINT}</span>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
