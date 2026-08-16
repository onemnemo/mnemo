import { useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Segmented } from "@/flashcards/transfer/components/Segmented"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ConflictPolicy, TransferFormatDto } from "@/api/types"
import { formatFileSize, importExtensions, MAX_FILES, type QueuedFile } from "../transfer"

const CONFLICT_OPTIONS: { value: ConflictPolicy; labelKey: string; captionKey: string }[] = [
  { value: "KeepBoth", labelKey: "TransferConflictKeepBoth", captionKey: "TransferConflictKeepBothCaption" },
  { value: "Skip", labelKey: "TransferConflictSkip", captionKey: "TransferConflictSkipCaption" },
  { value: "Replace", labelKey: "TransferConflictReplace", captionKey: "TransferConflictReplaceCaption" },
]

/** The import side of the note transfer dialog: the file queue, and what to do about collisions. */
export function NoteImportPanel({
  queue,
  formats,
  rejected,
  conflict,
  busy,
  ready,
  onAddFiles,
  onRemove,
  onConflictChange,
}: {
  queue: QueuedFile[]
  formats: TransferFormatDto[]
  /** Names turned away before upload, for the notice under the list. */
  rejected: string[]
  conflict: ConflictPolicy
  busy: boolean
  /** False until the format list lands; picking before then would refuse every file. */
  ready: boolean
  onAddFiles: (files: File[]) => void
  onRemove: (key: string) => void
  onConflictChange: (policy: ConflictPolicy) => void
}) {
  const t = useT()
  const nt = (key: string, params?: Record<string, string | number>) => t("Notes", key, params)
  const common = (key: string, params?: Record<string, string | number>) => t("Common", key, params)

  const inputRef = useRef<HTMLInputElement>(null)
  const extensions = importExtensions(formats)
  const atLimit = queue.length >= MAX_FILES
  const locked = busy || !ready

  const pick = () => inputRef.current?.click()

  const describe = (file: QueuedFile) => {
    const parts = [formatFileSize(file.sizeBytes)]
    if (file.formatName) parts.push(file.formatName)
    if (typeof file.noteCount === "number" && file.status === "ready") {
      const noun = nt(file.noteCount === 1 ? "TransferNounSingular" : "TransferNounPlural")
      parts.push(
        file.noteCount === 1
          ? common("TransferOneItemFormat", { 0: noun })
          : common("TransferManyItemsFormat", { 0: file.noteCount, 1: noun }),
      )
    }
    return parts.join(" · ")
  }

  return (
    // The whole panel takes drops, not just the empty-state dropzone: the dropzone is replaced by
    // the file list after the first file, and dragging a second one onto that list should work.
    <div
      className="space-y-[18px]"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (!locked) onAddFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={extensions.join(",")}
        aria-label={nt("TransferImportTitle")}
        className="hidden"
        onChange={(event) => {
          onAddFiles(Array.from(event.target.files ?? []))
          // Reset so re-picking the same file still fires a change.
          event.target.value = ""
        }}
      />

      {queue.length === 0 ? (
        <Dropzone extensions={extensions} disabled={locked} onBrowse={pick} />
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-body-extra-small font-semibold text-text-secondary">
              {common("TransferFilesLabel")}
            </span>
            <span className={cn("font-mono text-caption", atLimit ? "text-[var(--toast-accent-warning)]" : "text-text-faded")}>
              {common("TransferFileCountFormat", { 0: queue.length, 1: MAX_FILES })}
            </span>
          </div>

          <div className="scroll-thin max-h-[216px] space-y-1 overflow-y-auto">
            {queue.map((file) => (
              <FileRow
                key={file.key}
                file={file}
                detail={describe(file)}
                removeLabel={t("Common", "Delete")}
                busy={busy}
                onRemove={() => onRemove(file.key)}
              />
            ))}
          </div>

          {atLimit ? (
            <p className="rounded-md bg-[var(--toast-icon-badge-warning)] px-2.5 py-1.5 text-caption text-[var(--toast-accent-warning)]">
              {common("TransferLimitReachedFormat", { 0: MAX_FILES })}
            </p>
          ) : (
            <button
              type="button"
              disabled={locked}
              onClick={pick}
              className="h-8 w-full rounded-md border border-dashed border-line text-body-extra-small text-text-tertiary transition-colors hover:border-brand hover:text-text-secondary disabled:opacity-50"
            >
              {common("TransferAddAnotherFile")}
            </button>
          )}
        </div>
      )}

      {rejected.length > 0 ? (
        <p className="text-caption text-[var(--toast-accent-warning)]">
          {rejected.map((name) => common("TransferUnsupportedFile", { 0: name })).join(" ")}
        </p>
      ) : null}

      <div className="space-y-2">
        <span className="block text-body-extra-small font-semibold text-text-secondary">
          {nt("TransferConflictQuestion")}
        </span>
        <Segmented
          label={nt("TransferConflictQuestion")}
          value={conflict}
          onChange={onConflictChange}
          options={CONFLICT_OPTIONS.map((option) => ({
            value: option.value,
            label: common(option.labelKey),
            disabled: busy,
          }))}
        />
        <p className="text-caption text-text-tertiary">
          {common(CONFLICT_OPTIONS.find((option) => option.value === conflict)?.captionKey ?? "")}
        </p>
      </div>
    </div>
  )
}

/** The empty state. Dropping is handled by the panel around it, which stays after files arrive. */
function Dropzone({
  extensions,
  disabled,
  onBrowse,
}: {
  extensions: string[]
  disabled: boolean
  onBrowse: () => void
}) {
  const t = useT()
  const common = (key: string) => t("Common", key)

  return (
    <div className="group flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-7 text-center transition-colors hover:border-brand">
      <div className="grid size-10 place-items-center rounded-lg bg-surface-subtle text-text-tertiary">
        <AppIcon name="common/download" size={18} />
      </div>
      <p className="text-body-extra-small text-text-secondary">
        {common("TransferDropFileHere")} {common("TransferDropOr")}{" "}
        <button
          type="button"
          disabled={disabled}
          onClick={onBrowse}
          className="text-brand underline-offset-2 hover:underline disabled:opacity-50"
        >
          {common("TransferBrowse")}
        </button>
      </p>
      <div className="flex flex-wrap justify-center gap-1">
        {extensions.map((extension) => (
          <span
            key={extension}
            className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-caption text-text-faded"
          >
            {extension}
          </span>
        ))}
      </div>
    </div>
  )
}

function FileRow({
  file,
  detail,
  removeLabel,
  busy,
  onRemove,
}: {
  file: QueuedFile
  detail: string
  removeLabel: string
  busy: boolean
  onRemove: () => void
}) {
  const rejected = file.status === "rejected"
  const uploading = file.status === "uploading"

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-2.5 py-2">
      <div
        className={cn(
          "grid size-[30px] shrink-0 place-items-center rounded-md",
          rejected
            ? "bg-[var(--toast-icon-badge-warning)] text-[var(--toast-accent-warning)]"
            : "bg-brand-subtle text-brand",
          uploading && "animate-pulse",
        )}
      >
        <AppIcon name={rejected ? "common/triangle-alert" : "common/file-text"} size={15} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-body-extra-small font-medium text-text-primary" title={file.name}>
          {file.name}
        </div>
        <div className={cn("truncate text-caption", rejected ? "text-[var(--toast-accent-warning)]" : "text-text-tertiary")}>
          {rejected ? (file.notes?.join(" ") ?? detail) : detail}
        </div>
      </div>

      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        disabled={busy}
        onClick={onRemove}
        className="grid size-6 shrink-0 place-items-center rounded text-text-faded hover:bg-surface-subtle hover:text-text-secondary disabled:pointer-events-none disabled:opacity-40"
      >
        <AppIcon name="common/x" size={13} />
      </button>
    </div>
  )
}
