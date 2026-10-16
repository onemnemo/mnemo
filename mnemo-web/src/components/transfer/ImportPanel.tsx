import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { tPlural } from "@/i18n/plural"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { fileNoteText, formatFileSize, MAX_QUEUED, type QueuedImport } from "./import-queue"

const QUEUE_FULL = { one: "TransferQueueFullOne", many: "TransferQueueFullMany" }
const DROP_TO_ADD = { one: "TransferDropToAddOne", many: "TransferDropToAddMany" }

/** The import tab's body. Shows the drop area until a file is queued, then the queue. */
export function ImportPanel<Q extends QueuedImport>({
  queue,
  describe,
  warning,
  refused,
  overflow,
  empty = false,
  locked,
  dropCount = null,
  reading = false,
  folders = false,
  onBrowse,
  onRemove,
  conflict,
}: {
  queue: readonly Q[]
  describe: (file: Q) => string | null
  warning?: (file: Q) => string | null
  refused: readonly string[]
  overflow: boolean
  /** A picked or dropped folder held nothing to import. */
  empty?: boolean
  locked: boolean
  /** Number of items dragged over the window. 0 when the platform does not say. null when nothing is dragged. */
  dropCount?: number | null
  reading?: boolean
  /** Changes the drop area text for dialogs that take a folder. */
  folders?: boolean
  onBrowse: () => void
  onRemove: (key: string) => void
  conflict?: ReactNode
}) {
  const t = useT()
  const common = (key: string, params?: Record<string, string | number>) => t("Common", key, params)

  const messages = [
    ...refused.map((name) => common("TransferUnsupportedFile", { 0: name })),
    overflow ? tPlural(t, "Common", QUEUE_FULL, MAX_QUEUED) : null,
    empty ? common("TransferFolderEmpty") : null,
  ].filter(Boolean)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {queue.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col px-6 pt-5 pb-6">
          <button
            type="button"
            disabled={locked}
            onClick={onBrowse}
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5 rounded-[10px] border-[1.5px] border-dashed border-line text-center transition-colors hover:bg-surface-subtle disabled:pointer-events-none disabled:opacity-60"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-surface-subtle text-text-secondary">
              <AppIcon name="common/download" size={20} />
            </span>
            <span>
              <span className="block text-[13px] font-medium text-text-primary">
                {common(folders ? "TransferDropFilesOrFolder" : "TransferDropFileHere")}
              </span>
              <span className="mt-1 block text-[12px] text-text-secondary">{common("TransferClickToBrowse")}</span>
            </span>
          </button>
          {reading || messages.length > 0 ? <Notes reading={reading} messages={messages} className="pt-2" /> : null}
        </div>
      ) : (
        <>
          <Queue queue={queue} describe={describe} warning={warning} locked={locked} onRemove={onRemove} />
          {reading || messages.length > 0 ? <Notes reading={reading} messages={messages} className="pb-1" /> : null}
          {conflict}
        </>
      )}

      {dropCount !== null ? (
        <div className="absolute inset-0 z-10 flex bg-[var(--overlay-background)] px-6 pt-1 pb-6">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-[10px] border-[1.5px] border-accent bg-accent-wash text-center shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_12%,transparent)]">
            <DropIllustration count={dropCount} />
            <div>
              <p className="text-[13px] font-medium text-accent-ink">
                {dropCount > 0 ? tPlural(t, "Common", DROP_TO_ADD, dropCount) : common("TransferDropToImport")}
              </p>
              <p className="mt-1 text-[12px] text-accent-ink">{common("TransferDropChecked")}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Notes({ reading, messages, className }: { reading: boolean; messages: unknown[]; className?: string }) {
  const t = useT()
  return (
    <div className={cn("shrink-0 px-6 text-[12px]", className)}>
      {reading ? <p className="text-text-secondary">{t("Common", "TransferReadingFolder")}</p> : null}
      {messages.length > 0 ? <p className="text-danger">{messages.join(" ")}</p> : null}
    </div>
  )
}

function DropIllustration({ count }: { count: number }) {
  const page = "absolute h-12 w-10 rounded-lg border bg-surface"
  return (
    <div aria-hidden className="relative h-14 w-16">
      <div className={cn(page, "top-1.5 left-1.5 -rotate-[9deg] border-accent/30")} />
      <div className={cn(page, "top-0.5 left-[18px] rotate-[7deg] border-accent/30")} />
      <div
        className={cn(
          page,
          "top-1 left-3 flex flex-col gap-[5px] border-accent/50 px-[9px] py-3 shadow-[0_6px_16px_-6px_color-mix(in_oklab,var(--accent)_40%,transparent)]",
        )}
      >
        <span className="h-[3px] w-[70%] rounded-sm bg-accent/50" />
        <span className="h-[3px] w-full rounded-sm bg-accent/25" />
        <span className="h-[3px] w-[85%] rounded-sm bg-accent/25" />
        <span className="h-[3px] w-[60%] rounded-sm bg-accent/25" />
      </div>
      {count > 0 ? (
        <span className="absolute -right-0.5 -bottom-1 grid size-[22px] place-items-center rounded-full border-2 border-accent-wash bg-accent-ink text-[11px] font-semibold text-solid-fg">
          {count}
        </span>
      ) : null}
    </div>
  )
}

function Queue<Q extends QueuedImport>({
  queue,
  describe,
  warning,
  locked,
  onRemove,
}: {
  queue: readonly Q[]
  describe: (file: Q) => string | null
  warning?: (file: Q) => string | null
  locked: boolean
  onRemove: (key: string) => void
}) {
  const t = useT()
  const list = useRef<HTMLUListElement>(null)
  const [moreBelow, setMoreBelow] = useState(false)

  // Scripted rather than a scroll-driven animation, which WebKit lacks.
  const measure = () => {
    const element = list.current
    if (element) setMoreBelow(element.scrollHeight - element.scrollTop - element.clientHeight > 4)
  }
  useLayoutEffect(measure, [queue])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ul
        ref={list}
        aria-label={t("Common", "TransferQueueLabel")}
        onScroll={measure}
        className="queue-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-1.5"
      >
        {queue.map((file) => (
          <FileRow
            key={file.key}
            file={file}
            detail={describe(file)}
            warning={warning?.(file) ?? null}
            locked={locked}
            onRemove={() => onRemove(file.key)}
          />
        ))}
      </ul>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-b from-transparent to-[var(--overlay-background)] transition-opacity",
          moreBelow ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  )
}

function FileRow<Q extends QueuedImport>({
  file,
  detail,
  warning,
  locked,
  onRemove,
}: {
  file: Q
  detail: string | null
  warning: string | null
  locked: boolean
  onRemove: () => void
}) {
  const t = useT()
  const uploading = file.status === "uploading"
  const skipped = file.status === "rejected" || warning !== null
  const reason = file.status === "rejected" ? file.notes?.map((note) => fileNoteText(t, note)).join(" ") : warning
  const second = skipped
    ? reason
    : uploading
      ? t("Common", "TransferPreparing")
      : [file.path, formatFileSize(file.sizeBytes), detail].filter(Boolean).join(" · ")
  const remove = t("Common", "Delete")

  return (
    <li
      className={cn(
        "flex h-12 shrink-0 items-center gap-3 rounded-lg pr-1.5 pl-3",
        skipped && "bg-[color-mix(in_oklab,var(--danger-wash)_50%,var(--surface))]",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[13px]", skipped ? "text-text-secondary" : "text-text-primary")} title={file.name}>
          {file.name}
        </div>
        <div className="mt-px flex items-center gap-[5px] text-[12px] text-text-secondary">
          {skipped ? <AppIcon name="common/triangle-alert" size={13} className="shrink-0 text-danger" /> : null}
          <span className="truncate">{second}</span>
        </div>
      </div>
      {uploading ? (
        <span role="progressbar" aria-label={file.name} className="grid size-7 shrink-0 place-items-center">
          <span className="size-[18px] animate-spin rounded-full border-[2.25px] border-line border-t-solid" />
        </span>
      ) : (
        <button
          type="button"
          aria-label={`${remove} ${file.name}`}
          title={remove}
          disabled={locked}
          onClick={onRemove}
          className="grid size-7 shrink-0 place-items-center rounded-md text-text-tertiary hover:bg-frame-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
        >
          <AppIcon name="common/x" size={14} />
        </button>
      )}
    </li>
  )
}
