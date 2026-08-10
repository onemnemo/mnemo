import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { useCardAssetUrl } from "../assets"
import type { DraftAttachment } from "../draft"
import { MAX_ATTACHMENTS_PER_SIDE } from "../editor-state"

/**
 * A side's attached images as a compact strip of thumbnails, with an add slot that states how
 * many of the limit are used rather than waiting to reject the file that would go over it.
 *
 * The images sit under their own field: an image belongs to a side, and a separate panel listing
 * every image on the card leaves the reader working out which one is on the back. Removing only
 * drops the draft entry; the stored file is not deleted until the card is saved, so closing the
 * dialog leaves the card exactly as it was.
 */
export function AttachmentStrip({
  attachments,
  canAttach,
  onAdd,
  onRemove,
}: {
  attachments: DraftAttachment[]
  canAttach: boolean
  onAdd: () => void
  onRemove: (key: string) => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {attachments.map((attachment) => (
        <Thumb
          key={attachment.key}
          attachment={attachment}
          removeLabel={`${fc("Remove")} ${attachment.displayName}`}
          onRemove={() => onRemove(attachment.key)}
        />
      ))}

      {canAttach ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label={fc("InsertImage")}
          title={fc("InsertImage")}
          className="flex h-14 w-20 flex-col items-center justify-center gap-1 rounded-lg text-ink-3 shadow-[0_0_0_1px_var(--line-soft)] transition-colors hover:bg-frame-hover hover:text-ink-2"
        >
          <AppIcon name="image-plus" size={16} strokeWidth={1.7} />
          <span className="text-[10.5px] tabular-nums">
            {attachments.length} / {MAX_ATTACHMENTS_PER_SIDE}
          </span>
        </button>
      ) : null}
    </div>
  )
}

function Thumb({
  attachment,
  removeLabel,
  onRemove,
}: {
  attachment: DraftAttachment
  removeLabel: string
  onRemove: () => void
}) {
  const url = useCardAssetUrl(attachment.assetId)

  return (
    <span className="group/thumb relative flex h-14 w-20 items-center justify-center overflow-hidden rounded-lg bg-canvas-sunken shadow-[0_0_0_1px_var(--line-soft)]">
      {url ? (
        <img src={url} alt={attachment.displayName} className="max-h-full max-w-full object-contain" />
      ) : (
        // An attachment imported from outside the managed images directory has no servable id, so
        // there is nothing to load and the frame stands in for it.
        <AppIcon name="common/image" size={18} className="text-ink-3" />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="absolute top-1 right-1 grid size-5 place-items-center rounded-md bg-canvas/90 text-ink-2 opacity-0 shadow-canvas transition-opacity hover:text-danger group-hover/thumb:opacity-100 focus-visible:opacity-100"
      >
        <AppIcon name="x" size={12} strokeWidth={2.4} />
      </button>
    </span>
  )
}
