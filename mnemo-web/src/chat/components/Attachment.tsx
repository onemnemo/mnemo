import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useAssetObjectUrl } from "../assets"
import type { ChatAttachment } from "../types"

// Attachments render two ways: an image thumbnail (bytes fetched as a blob, since a bare
// <img src> can't carry the /api bearer token) or a labelled file chip. The same items
// appear read-only on a sent message and removable in the composer.

interface AttachmentLike {
  kind: "image" | "file"
  displayName: string | null
  assetId: string | null
}

/** Attachments shown on a sent user message (read-only). */
export function MessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  if (attachments.length === 0) return null
  return (
    <div className="flex max-w-[560px] flex-wrap justify-end gap-2">
      {attachments.map((a, i) => (
        <AttachmentItem key={i} attachment={a} />
      ))}
    </div>
  )
}

/** Composer chips for uploaded-but-unsent attachments, each removable. */
export function PendingAttachments({
  attachments,
  onRemove,
}: {
  attachments: AttachmentLike[]
  onRemove: (assetId: string) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((a, i) => (
        <AttachmentItem
          key={a.assetId ?? i}
          attachment={a}
          onRemove={a.assetId ? () => onRemove(a.assetId as string) : undefined}
        />
      ))}
    </div>
  )
}

function AttachmentItem({ attachment, onRemove }: { attachment: AttachmentLike; onRemove?: () => void }) {
  if (attachment.kind === "image" && attachment.assetId) {
    return <ImageThumb attachment={attachment} onRemove={onRemove} />
  }
  return <FileChip attachment={attachment} onRemove={onRemove} />
}

function ImageThumb({ attachment, onRemove }: { attachment: AttachmentLike; onRemove?: () => void }) {
  const url = useAssetObjectUrl(attachment.assetId)
  return (
    <div className="relative">
      <div className="size-16 overflow-hidden rounded-lg border border-line bg-surface-subtle">
        {url ? (
          <img src={url} alt={attachment.displayName ?? ""} className="size-full object-cover" />
        ) : (
          <div className="size-full animate-pulse" />
        )}
      </div>
      {onRemove ? <RemoveButton onRemove={onRemove} floating /> : null}
    </div>
  )
}

function FileChip({ attachment, onRemove }: { attachment: AttachmentLike; onRemove?: () => void }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-subtle px-2.5 py-1.5 text-body-small text-text-secondary">
      <AppIcon name="common/file-text" size={14} className="shrink-0 text-text-faded" />
      <span className="max-w-[160px] truncate">{attachment.displayName ?? "file"}</span>
      {onRemove ? <RemoveButton onRemove={onRemove} /> : null}
    </div>
  )
}

function RemoveButton({ onRemove, floating }: { onRemove: () => void; floating?: boolean }) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={t("Common", "Delete")}
      title={t("Common", "Delete")}
      className={cn(
        "grid size-4 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80",
        floating ? "absolute -top-1.5 -right-1.5 shadow-[var(--elevation-1)]" : "-mr-0.5 ml-0.5",
      )}
    >
      <AppIcon name="common/x" size={10} />
    </button>
  )
}
