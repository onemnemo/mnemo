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

import { discardUpload, runExport, runImport, uploadTransferFile, useTransferFormatsQuery } from "./api"
import type { TransferTarget } from "./store"
import { exportFormats, exportKind, queuedFromUpload, readyCardCount, type QueuedFile } from "./transfer"

/** Translation keys for each format's name and caption. */
const FORMAT_KEYS: Record<string, { label: string; caption: string }> = {
  "flashcards.mnemo": { label: "TransferFormatArchive", caption: "TransferFormatCaptionMnemo" },
  "flashcards.csv": { label: "TransferFormatCsv", caption: "TransferFormatCaptionCsv" },
  "flashcards.anki": { label: "TransferFormatAnki", caption: "TransferFormatCaptionAnki" },
}

// Named TransferDialog rather than Transfer: this file sits beside transfer.ts, and the two names
// differ only in case, which Windows checkouts cannot tell apart.
export function TransferDialog({ target, onClose }: { target: TransferTarget; onClose: () => void }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const common = (key: string, params?: Record<string, string | number>) => t("Common", key, params)

  const client = useQueryClient()
  const formats = useTransferFormatsQuery(true)
  // The query's own array is stable, but the empty fallback is not - and both feed an effect
  // dependency below, so the placeholder has to hold still while the fetch is in flight.
  const formatList = useMemo(() => formats.data ?? [], [formats.data])

  const [direction, setDirection] = useState<TransferDirection>(target.direction === "export" ? "export" : "import")
  const { conflict, setConflict, onEdit } = useConflictChoice()
  const [busy, setBusy] = useState(false)

  const scope = target.scope
  const deckCount = scope?.deckIds.length ?? 0
  const folderIds = scope?.folderIds ?? []
  const hasFolders = folderIds.length > 0
  // Memoized because it is an effect dependency: rebuilding the array every render would re-run
  // the default-format effect on every keystroke elsewhere in the dialog.
  const available = useMemo(() => exportFormats(formatList, deckCount, hasFolders), [formatList, deckCount, hasFolders])

  const [exportFormat, setExportFormat] = useExportFormat(available)

  // Without the format list every file looks unsupported, so the import side stays shut until it
  // lands. A failure is said out loud rather than left as a dialog that silently refuses
  // everything the user drops on it.
  const formatsReady = formats.isSuccess
  useFormatsErrorToast(formats)

  const imports = useImportQueue({
    upload: uploadTransferFile,
    discard: discardUpload,
    toRow: queuedFromUpload,
    accepts: (name) => isImportable(name, formatList),
    failureNote: (error, name) => describeError(t, error) ?? common("TransferUnreadableFile", { 0: name }),
    onEdit,
  })
  const queue = imports.queue
  const collisions = packageCollisions(queue, "flashcards")
  const colliding = packageCollidingKeys(queue, "flashcards")
  const policy = collisions > 0 ? conflict : "KeepBoth"
  useResetConflict(collisions, setConflict)
  const replacing = policy === "Replace"
  const locked = busy || !formatsReady
  const dropCount = useFileDropCount(direction === "import", locked, (data) =>
    imports.add(Array.from(data.files, (file) => ({ file, path: "" }))),
  )

  const cardCount = readyCardCount(queue)
  const itemPhrase = useItemPhrase("Flashcards")

  const describeRow = (file: QueuedFile) =>
    [
      file.formatName,
      typeof file.cardCount === "number" ? itemPhrase(file.cardCount) : null,
      colliding.has(file.key) ? common("TransferInYourLibrary") : null,
    ]
      .filter(Boolean)
      .join(" · ")

  const doImport = async () => {
    if (busy) return
    setBusy(true)
    const targetFolderId = target.destination?.folderId ?? null
    const outcome = await imports.importReady((rows) =>
      runImport({ uploadIds: rows.map((row) => row.uploadId!), conflictPolicy: policy, targetFolderId }),
    )
    // An import can create folders, decks and cards, so the whole key is stale.
    await client.invalidateQueries({ queryKey: ["flashcards"] })
    setBusy(false)
    if (announceImport(t, outcome, (result) => itemPhrase(result.importedCards))) onClose()
  }

  const selectedExtension = available.find((format) => format.formatId === exportFormat)?.extensions[0] ?? ""

  const doExport = async () => {
    if (!exportFormat || !scope || scope.deckIds.length === 0 || busy) return

    setBusy(true)
    try {
      const outcome = await runExport(
        {
          formatId: exportFormat,
          deckIds: scope.deckIds,
          folderIds,
          kind: exportKind(scope.wholeCollection),
        },
        {
          ...exportSaveOptions(common),
          fileName: exportFileName(
            (hasFolders ? folderIds.length === 1 : scope.deckIds.length === 1) ? scope.label : null,
            "flashcards",
            selectedExtension,
          ),
        },
      )
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
  const emptyScope = !scope || scope.deckIds.length === 0
  const confirmEnabled = importing ? canImport(queue) && !busy : !emptyScope && exportFormat !== null && !busy

  const confirm = () => void (importing ? doImport() : doExport())

  const confirmLabel = !importing
    ? common("TransferExportTab")
    : imports.progress
      ? importingLabel(t, imports.progress)
      : replacing
        ? replaceLabel(t, collisions, readyOutside(queue, colliding))
        : // A plain "Import" when the card count is unknown.
          cardCount === null
          ? fc("Import")
          : common("TransferImportButtonFormat", { 0: itemPhrase(cardCount) })
  const discards = replacing && !imports.progress ? replaceDiscards(queue, "flashcards") : 0
  const replaceNote = discards > 0 ? common("TransferEvidenceReplaceDiscardsFormat", { 0: discards }) : null

  const picker = useImportPicker({ extensions: importExtensions(formatList), onAdd: imports.add })
  const options = available.map((format) => {
    const keys = FORMAT_KEYS[format.formatId]
    return {
      formatId: format.formatId,
      label: keys ? common(keys.label) : format.displayName,
      caption: keys ? common(keys.caption) : "",
      extension: format.extensions[0] ?? "",
    }
  })
  const named = scope ? (hasFolders ? folderIds.length === 1 : scope.deckIds.length === 1) : false
  const contents = scope ? (named ? scope.label : itemPhrase(scope.deckIds.length)) : ""

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
            warning={(file) => (packageTooNew(file, "flashcards") ? common("TransferEvidenceTooNew") : null)}
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
        <p className="py-6 text-center text-body-extra-small text-text-tertiary">{fc("ExportFlashcardsNoDecksMessage")}</p>
      ) : (
        <ExportFormatList
          groupLabel={common("TransferFormatGroupLabel")}
          contents={contents}
          formats={options}
          selected={exportFormat}
          busy={busy}
          unavailable={fc("ExportFormatUnavailableMessage")}
          onSelect={setExportFormat}
        />
      )}
    </TransferShell>
  )
}
