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
  readyOutside,
  REPLACE_BUTTON_CLASS,
} from "@/components/transfer/import-queue"
import { ImportPanel } from "@/components/transfer/ImportPanel"
import { ImportStatus, ReplaceNote } from "@/components/transfer/ImportStatus"
import { announceImport, useImportQueue } from "@/components/transfer/useImportQueue"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import { isMac } from "@/keybinds/chord"
import { useFileDrop } from "@/lib/useFileDrop"
import { cn } from "@/lib/utils"
import { toast } from "@/stores/toast"

import { discardUpload, runExport, runImport, uploadTransferFile, useTransferFormatsQuery } from "./api"
import { ExportPanel } from "./components/ExportPanel"
import { Segmented } from "./components/Segmented"
import type { TransferTarget } from "./store"
import { exportFormats, exportKind, queuedFromUpload, readyCardCount, type QueuedFile } from "./transfer"

const SHORTCUT_HINT = isMac ? "⌘⏎" : "Ctrl+⏎"

type Direction = "import" | "export"

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

  const [direction, setDirection] = useState<Direction>(target.direction === "export" ? "export" : "import")
  const [conflict, setConflict] = useState<ConflictPolicy>("KeepBoth")
  const [exportFormat, setExportFormat] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const scope = target.scope
  const deckCount = scope?.deckIds.length ?? 0
  const folderIds = scope?.folderIds ?? []
  const hasFolders = folderIds.length > 0
  // Memoized because it is an effect dependency: rebuilding the array every render would re-run
  // the default-format effect on every keystroke elsewhere in the dialog.
  const available = useMemo(() => exportFormats(formatList, deckCount, hasFolders), [formatList, deckCount, hasFolders])

  // Default to the first offered format once the list arrives, and correct a selection the format
  // list no longer contains rather than leaving Confirm pointing at nothing.
  useEffect(() => {
    if (available.length === 0) return
    setExportFormat((current) =>
      current && available.some((format) => format.formatId === current) ? current : available[0].formatId,
    )
  }, [available])

  // Without the format list every file looks unsupported, so the import side stays shut until it
  // lands. A failure is said out loud rather than left as a dialog that silently refuses
  // everything the user drops on it.
  const formatsReady = formats.isSuccess
  useEffect(() => {
    if (formats.isError) {
      toast.warning(common("ImportFailedTitle"), { description: describeError(t, formats.error) })
    }
    // Keyed on the error alone: `common` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formats.isError])

  const imports = useImportQueue({
    upload: uploadTransferFile,
    discard: discardUpload,
    toRow: queuedFromUpload,
    accepts: (name) => isImportable(name, formatList),
    failureNote: (error, name) => describeError(t, error) ?? common("TransferUnreadableFile", { 0: name }),
    // A replace is consented to for one queue. Any edit asks again.
    onEdit: () => setConflict((policy) => (policy === "Replace" ? "KeepBoth" : policy)),
  })
  const queue = imports.queue
  const collisions = packageCollisions(queue, "flashcards")
  const colliding = packageCollidingKeys(queue, "flashcards")
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

  const cardCount = readyCardCount(queue)
  const itemPhrase = (count: number) => {
    const noun = fc(count === 1 ? "TransferNounSingular" : "TransferNounPlural")
    return count === 1
      ? common("TransferOneItemFormat", { 0: noun })
      : common("TransferManyItemsFormat", { 0: count, 1: noun })
  }

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
    ? common("TransferExportButtonFormat", { 0: selectedExtension })
    : replacing
      ? replaceLabel(t, collisions, readyOutside(queue, colliding))
      : // A plain "Import" when the card count is unknown.
        cardCount === null
        ? fc("Import")
        : common("TransferImportButtonFormat", { 0: itemPhrase(cardCount) })
  const discards = replacing && !imports.progress ? replaceDiscards(queue, "flashcards") : 0
  const replaceNote = discards > 0 ? common("TransferEvidenceReplaceDiscardsFormat", { 0: discards }) : null

  const fileSummary =
    queue.length === 1 ? common("TransferOneFile") : common("TransferManyFilesFormat", { 0: queue.length })
  const summary = importing
    ? [fileSummary, cardCount === null ? null : itemPhrase(cardCount)].filter(Boolean).join(" · ")
    : common("TransferOneFile")

  const title = importing
    ? fc("TransferImportTitle")
    : scope && scope.deckIds.length === 1 && !hasFolders
      ? fc("TransferExportDeckTitle")
      : fc("TransferExportTitle")

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
                // Named after both sides, not after the panel that happens to be open.
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

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-[18px]">
            {importing ? (
              <ImportPanel
                queue={queue}
                extensions={importExtensions(formatList)}
                describe={describeRow}
                warning={(file) => (packageTooNew(file, "flashcards") ? common("TransferEvidenceTooNew") : null)}
                refused={imports.refused}
                overflow={imports.overflow}
                destination={
                  target.destination ? fc("TransferImportDestinationFormat", { 0: target.destination.label }) : undefined
                }
                locked={locked}
                dropping={over}
                onAdd={imports.add}
                onRemove={(key) => !busy && imports.remove(key)}
              />
            ) : emptyScope ? (
              <p className="py-6 text-center text-body-extra-small text-text-tertiary">
                {fc("ExportFlashcardsNoDecksMessage")}
              </p>
            ) : (
              <ExportPanel
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
