import { useRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { tPlural } from "@/i18n/plural"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { fileNoteText, formatFileSize, MAX_QUEUED, type PickedFile, type QueuedImport } from "./import-queue"

const QUEUE_FULL = { one: "TransferQueueFullOne", many: "TransferQueueFullMany" }

export function ImportPanel<Q extends QueuedImport>({
  queue,
  extensions,
  describe,
  warning,
  refused,
  overflow,
  empty = false,
  destination,
  locked,
  dropping = false,
  reading = false,
  onAdd,
  onRemove,
  onPickFolder,
}: {
  queue: readonly Q[]
  extensions: string[]
  describe: (file: Q) => string | null
  warning?: (file: Q) => string | null
  refused: readonly string[]
  overflow: boolean
  /** A picked or dropped folder held nothing to import. */
  empty?: boolean
  destination?: string
  locked: boolean
  dropping?: boolean
  reading?: boolean
  onAdd: (files: PickedFile[]) => void
  onRemove: (key: string) => void
  onPickFolder?: (files: File[]) => void
}) {
  const t = useT()
  const common = (key: string, params?: Record<string, string | number>) => t("Common", key, params)
  const input = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const browse = () => input.current?.click()

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={extensions.join(",")}
        onChange={(event) => {
          onAdd(Array.from(event.target.files ?? [], (file) => ({ file, path: "" })))
          // Cleared so picking the same file again still fires a change.
          event.target.value = ""
        }}
      />
      {onPickFolder ? (
        <input
          // React has no typed prop for the folder picker attribute.
          ref={(element) => {
            folderInput.current = element
            element?.setAttribute("webkitdirectory", "")
          }}
          type="file"
          hidden
          onChange={(event) => {
            onPickFolder(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
      ) : null}

      {queue.length === 0 ? (
        <div
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-6 text-center transition-colors",
            dropping ? "border-accent bg-accent-wash/40" : "border-line",
          )}
        >
          <div className="grid size-10 place-items-center rounded-lg bg-surface-subtle text-text-tertiary">
            <AppIcon name="common/download" size={18} />
          </div>
          {dropping ? (
            <p className="text-[12.5px] font-medium text-ink">{common("TransferDropToImport")}</p>
          ) : (
            <p className="text-[12.5px] text-ink-2">
              {onPickFolder ? (
                // The sentence is translated whole and the two links go where {0} and {1} sit.
                common("TransferDropBrowseFolderFormat")
                  .split(/(\{[01]\})/)
                  .map((part, index) =>
                    part === "{0}" ? (
                      <LinkButton key={index} disabled={locked} onClick={browse}>
                        {common("TransferBrowse")}
                      </LinkButton>
                    ) : part === "{1}" ? (
                      <LinkButton key={index} disabled={locked} onClick={() => folderInput.current?.click()}>
                        {common("TransferChooseFolder")}
                      </LinkButton>
                    ) : (
                      part
                    ),
                  )
              ) : (
                <>
                  {common("TransferDropFileHere")} {common("TransferDropOr")}{" "}
                  <LinkButton disabled={locked} onClick={browse}>
                    {common("TransferBrowse")}
                  </LinkButton>
                </>
              )}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-1">
            {extensions.map((extension) => (
              <span key={extension} className="rounded bg-canvas-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3">
                {extension}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "-m-2 flex flex-col gap-1.5 rounded-lg p-2 transition-colors",
            dropping && "bg-accent-wash/40 outline-2 outline-accent outline-dashed",
          )}
        >
          <ul className="scroll-thin -mx-2 flex max-h-[264px] flex-col overflow-y-auto">
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
          <p className="text-[12.5px] text-ink-2">
            <LinkButton disabled={locked} onClick={browse}>
              {common("TransferAddAnotherFile")}
            </LinkButton>
            {onPickFolder ? (
              <>
                {" "}
                {common("TransferDropOr")}{" "}
                <LinkButton disabled={locked} onClick={() => folderInput.current?.click()}>
                  {common("TransferChooseFolder")}
                </LinkButton>
              </>
            ) : null}
          </p>
        </div>
      )}

      {reading ? <p className="text-[11.5px] text-ink-3">{common("TransferReadingFolder")}</p> : null}
      {empty ? <p className="text-[11.5px] text-danger">{common("TransferFolderEmpty")}</p> : null}

      {refused.length > 0 || overflow ? (
        <p className="text-[11.5px] text-danger">
          {[...refused.map((name) => common("TransferUnsupportedFile", { 0: name })), overflow ? tPlural(t, "Common", QUEUE_FULL, MAX_QUEUED) : null]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}

      {destination ? (
        <p className="flex items-start gap-2 text-[11.5px] text-ink-3">
          <AppIcon name="common/folder" size={13} className="mt-px shrink-0" />
          <span>{destination}</span>
        </p>
      ) : null}
    </div>
  )
}

function LinkButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="text-[12.5px] text-ink underline underline-offset-2 disabled:opacity-50"
    >
      {children}
    </button>
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
  const rejected = file.status === "rejected"
  const second = rejected
    ? file.notes?.map((note) => fileNoteText(t, note)).join(" ")
    : [file.path, formatFileSize(file.sizeBytes), file.status === "ready" ? detail : null].filter(Boolean).join(" · ")

  return (
    <li className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-frame-hover">
      <AppIcon
        name={rejected ? "common/triangle-alert" : "common/file-text"}
        size={15}
        className={cn("shrink-0", rejected ? "text-danger" : "text-ink-icon", file.status === "uploading" && "animate-pulse")}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-ink" title={file.name}>
          {file.name}
        </div>
        <div className={cn("truncate text-[11.5px]", rejected ? "text-danger" : "text-ink-3")}>{second}</div>
        {warning ? <div className="text-[11.5px] text-danger">{warning}</div> : null}
      </div>
      <button
        type="button"
        aria-label={t("Common", "Delete")}
        title={t("Common", "Delete")}
        disabled={locked}
        onClick={onRemove}
        className="grid size-6 shrink-0 place-items-center rounded text-ink-3 hover:bg-frame-active hover:text-ink disabled:pointer-events-none disabled:opacity-40"
      >
        <AppIcon name="common/x" size={13} />
      </button>
    </li>
  )
}
