import { useRef } from "react"

import type { ConflictPolicy, TransferFormatDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Segmented } from "@/flashcards/transfer/components/Segmented"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { fileNoteText, formatFileSize, importExtensions, MAX_FILES, type QueuedFile } from "../transfer"

const CONFLICT_OPTIONS: { value: ConflictPolicy; labelKey: string; captionKey: string }[] = [
  { value: "KeepBoth", labelKey: "TransferConflictKeepBoth", captionKey: "TransferConflictKeepBothCaption" },
  { value: "Skip", labelKey: "TransferConflictSkip", captionKey: "TransferConflictSkipCaption" },
  { value: "Replace", labelKey: "TransferConflictReplace", captionKey: "TransferConflictReplaceCaption" },
]

/** The import side of the mindmap transfer dialog: the file queue, and what to do about collisions. */
export function MindmapImportPanel({
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
  const mm = (key: string, params?: Record<string, string | number>) => t("Mindmap", key, params)
  const common = (key: string, params?: Record<string, string | number>) => t("Common", key, params)

  const inputRef = useRef<HTMLInputElement>(null)
  const extensions = importExtensions(formats)
  const atLimit = queue.length >= MAX_FILES
  const locked = busy || !ready

  const pick = () => inputRef.current?.click()

  const describe = (file: QueuedFile) => {
    const parts = [formatFileSize(file.sizeBytes)]
    if (file.formatName) {
      parts.push(file.formatName)
    }
    if (typeof file.mapCount === "number" && file.status === "ready") {
      const noun = mm(file.mapCount === 1 ? "TransferNounSingular" : "TransferNounPlural")
      parts.push(
        file.mapCount === 1
          ? common("TransferOneItemFormat", { 0: noun })
          : common("TransferManyItemsFormat", { 0: file.mapCount, 1: noun }),
      )
    }
    return parts.join(" · ")
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={extensions.join(",")}
        aria-label={mm("TransferImportTitle")}
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
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold text-ink-2">{common("TransferFilesLabel")}</span>
            <span className={cn("font-mono text-[11px]", atLimit ? "text-danger" : "text-ink-3")}>
              {common("TransferFileCountFormat", { 0: queue.length, 1: MAX_FILES })}
            </span>
          </div>

          <div className="flex max-h-[216px] flex-col gap-1 overflow-y-auto">
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
            <p className="rounded-md bg-danger-wash px-2.5 py-1.5 text-[11.5px] text-danger">
              {common("TransferLimitReachedFormat", { 0: MAX_FILES })}
            </p>
          ) : (
            <button
              type="button"
              disabled={locked}
              onClick={pick}
              className="h-8 w-full rounded-lg border border-dashed border-line text-[12px] text-ink-3 transition-colors hover:border-accent hover:text-ink-2 disabled:opacity-50"
            >
              {common("TransferAddAnotherFile")}
            </button>
          )}
        </div>
      )}

      {rejected.length > 0 ? (
        <p className="text-[11.5px] text-danger">
          {rejected.map((name) => common("TransferUnsupportedFile", { 0: name })).join(" ")}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold text-ink-2">{mm("TransferConflictQuestion")}</span>
        <Segmented
          label={mm("TransferConflictQuestion")}
          value={conflict}
          onChange={onConflictChange}
          options={CONFLICT_OPTIONS.map((option) => ({
            value: option.value,
            label: common(option.labelKey),
            disabled: busy,
          }))}
        />
        <p className="text-[11.5px] text-ink-3">
          {common(CONFLICT_OPTIONS.find((option) => option.value === conflict)?.captionKey ?? "")}
        </p>
      </div>
    </div>
  )
}

/** The empty state. Dropping is handled by the dialog around it, which stays after files arrive. */
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
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-7 text-center transition-colors hover:border-accent">
      <div className="grid size-10 place-items-center rounded-lg bg-canvas-sunken text-ink-3">
        <AppIcon name="common/download" size={18} />
      </div>
      <p className="text-[12px] text-ink-2">
        {common("TransferDropFileHere")} {common("TransferDropOr")}{" "}
        <button
          type="button"
          disabled={disabled}
          onClick={onBrowse}
          className="text-accent underline-offset-2 hover:underline disabled:opacity-50"
        >
          {common("TransferBrowse")}
        </button>
      </p>
      <div className="flex flex-wrap justify-center gap-1">
        {extensions.map((extension) => (
          <span key={extension} className="rounded bg-canvas-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3">
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
  const t = useT()
  const rejected = file.status === "rejected"
  const uploading = file.status === "uploading"

  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-canvas-sunken px-2.5 py-2">
      <div
        className={cn(
          "grid size-[30px] shrink-0 place-items-center rounded-md",
          rejected ? "bg-danger-wash text-danger" : "bg-accent-wash text-accent",
          uploading && "animate-pulse",
        )}
      >
        <AppIcon name={rejected ? "common/triangle-alert" : "common/sitemap"} size={15} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-ink" title={file.name}>
          {file.name}
        </div>
        <div className={cn("truncate text-[11px]", rejected ? "text-danger" : "text-ink-3")}>
          {rejected ? (file.notes?.map((note) => fileNoteText(t, note)).join(" ") ?? detail) : detail}
        </div>
      </div>

      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        disabled={busy}
        onClick={onRemove}
        className="grid size-6 shrink-0 place-items-center rounded text-ink-3 transition-colors hover:bg-frame-active hover:text-ink disabled:pointer-events-none disabled:opacity-40"
      >
        <AppIcon name="common/x" size={13} />
      </button>
    </div>
  )
}
