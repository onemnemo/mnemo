import type { CardAttachmentDto, CardDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useCardAssetUrl } from "../../editor/assets"
import { MathText } from "../../MathText"

/**
 * One card's two sides and its tags, with no chrome of its own.
 *
 * Its own component because a card is read in two places now, the browser's quick look
 * and the side peek, and the reading has to be identical in both: the same MathText the
 * editor and study use, and an attachment this card cannot serve shown as a named,
 * non-interactive pill rather than a broken frame.
 */
export function CardPeekBody({ card }: { card: CardDto }) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)
  const front = card.attachments.filter((a) => a.side === "front")
  const back = card.attachments.filter((a) => a.side === "back")

  return (
    <>
      <CardSide label={fc("FieldFront")} text={card.front} attachments={front} />
      <CardSide label={fc("FieldBack")} text={card.back} attachments={back} />

      {card.tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {card.tags.map((tag) => (
            <span key={tag} className="rounded-md bg-canvas-sunken px-2 py-0.5 text-[11.5px] text-ink-2">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </>
  )
}

function CardSide({
  label,
  text,
  attachments,
}: {
  label: string
  text: string
  attachments: CardAttachmentDto[]
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10.5px] font-semibold tracking-[0.05em] text-ink-3">{label}</p>
      <div className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">
        <MathText>{text}</MathText>
      </div>
      {attachments.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {attachments.map((attachment) => (
            <CardAttachment key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CardAttachment({ attachment }: { attachment: CardAttachmentDto }) {
  const url = useCardAssetUrl(attachment.assetId)

  // No servable asset id: an imported deck's file living outside the managed images
  // directory today, and the shape any future non-image attachment kind would take
  // tomorrow. Either way there is nothing to render as a picture, so it reads as a
  // named, non-interactive pill instead of a broken image or a thrown error.
  if (!attachment.assetId || !url) {
    return (
      <span className="flex max-w-[180px] items-center gap-1.5 rounded-full bg-canvas-sunken px-2.5 py-1 text-[11.5px] text-ink-2">
        <AppIcon name="common/image" size={12} className="shrink-0 text-ink-3" />
        <span className="truncate" title={attachment.displayName}>
          {attachment.displayName}
        </span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        "flex h-16 w-24 items-center justify-center overflow-hidden rounded-lg bg-canvas-sunken shadow-[0_0_0_1px_var(--line-soft)]",
      )}
    >
      <img
        src={url}
        alt={attachment.displayName}
        title={attachment.caption ?? attachment.displayName}
        className="max-h-full max-w-full object-contain"
      />
    </span>
  )
}
