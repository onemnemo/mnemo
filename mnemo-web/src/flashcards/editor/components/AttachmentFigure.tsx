import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { useCardAssetUrl } from "../assets"
import { attachmentSizeLabel } from "../editor-state"
import type { DraftAttachment } from "../draft"

const LINK_CLASS = "text-body-extra-small text-text-secondary transition-colors hover:text-text-primary"

/**
 * One attached image: thumbnail, name and size, and the replace/remove links. Removing only
 * drops it from the draft - the stored file is not deleted until the card is saved, so
 * cancelling the dialog leaves the card exactly as it was.
 */
export function AttachmentFigure({
  attachment,
  onReplace,
  onRemove,
}: {
  attachment: DraftAttachment
  onReplace: () => void
  onRemove: () => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)
  const url = useCardAssetUrl(attachment.assetId)

  return (
    <div className="flex rounded-md border border-line bg-[var(--card-background-secondary)] p-2.5">
      <div className="grid h-[104px] w-[170px] shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-[var(--widget-background-primary)]">
        {url ? (
          <img src={url} alt={attachment.displayName} className="size-full object-cover" />
        ) : (
          // An attachment imported from outside the managed images directory has no servable
          // id, so there is nothing to load and the frame stands in for it.
          <AppIcon name="common/image" size={20} className="text-text-faded" />
        )}
      </div>

      <div className="ml-3 flex min-w-0 flex-col justify-center gap-1.5">
        <span className="truncate text-[12.5px] text-text-secondary">
          {attachmentSizeLabel(attachment.displayName, attachment.sizeBytes)}
        </span>
        <span className="text-[11px] leading-[15px] text-text-faded">{fc("CardEditorFigureHint")}</span>
        <div className="mt-0.5 flex items-center gap-3.5">
          <button type="button" onClick={onReplace} className={LINK_CLASS}>
            {fc("CardEditorReplace")}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-body-extra-small text-destructive transition-opacity hover:opacity-80"
          >
            {t("Flashcards", "Remove")}
          </button>
        </div>
      </div>
    </div>
  )
}
