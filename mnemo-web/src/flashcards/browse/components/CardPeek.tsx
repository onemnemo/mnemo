import { Dialog } from "radix-ui"

import type { CardAttachmentDto, CardViewDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { StateTag, cardStateKind } from "../../bits"
import { useCardAssetUrl } from "../../editor/assets"
import { MathText } from "../../MathText"
import { dueLabel } from "../../deck/cards"

/**
 * A read-only quick look at one card, opened from the browser without leaving the table.
 *
 * Renders the same way study and the editor do - MathText for the body, the deck table's own
 * due/lapses readings - and never more: there is no field to type into here, and an attachment
 * this card cannot serve (imported from outside the managed images directory, or any kind that
 * is not an image) shows as a named, non-interactive pill rather than a broken frame or a crash.
 */
export function CardPeek({
  view,
  deckName,
  onClose,
  onEdit,
}: {
  view: CardViewDto
  deckName: string
  onClose: () => void
  onEdit: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const { card, schedule } = view
  const due = dueLabel(view, Date.now(), fc)
  const front = card.attachments.filter((a) => a.side === "front")
  const back = card.attachments.filter((a) => a.side === "back")

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[560px] max-w-[calc(100vw-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-soft bg-canvas shadow-pop focus:outline-none"
        >
          <div className="flex items-center gap-2.5 border-b border-line-soft px-5 py-3.5">
            <Dialog.Title className="text-[14px] font-semibold text-ink">{fc("PeekCard")}</Dialog.Title>
            <span className="truncate text-[12.5px] text-ink-3" title={deckName}>
              {deckName}
            </span>
            <div className="flex-1" />
            <StateTag state={cardStateKind(card, schedule)} />
            <Dialog.Close asChild>
              <IconButton icon="common/x" iconSize={14} label={t("Common", "Close")} />
            </Dialog.Close>
          </div>

          <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <PeekSide label={fc("FieldFront")} text={card.front} attachments={front} />
            <PeekSide label={fc("FieldBack")} text={card.back} attachments={back} />

            {card.tags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {card.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-canvas-sunken px-2 py-0.5 text-[11.5px] text-ink-2"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex h-12 shrink-0 items-center gap-4 border-t border-line-soft px-5 text-[12px] text-ink-3">
            <span className={due.isDue ? "font-medium text-state-due" : undefined}>{due.text}</span>
            <span>{fc("ColLapses")}: {schedule.lapses}</span>
            <div className="flex-1" />
            <Button variant="ghost" className="h-7" onClick={onClose}>
              {t("Common", "Close")}
            </Button>
            <Button variant="outline" className="h-7" icon={<AppIcon name="pencil" size={13} />} onClick={onEdit}>
              {fc("EditCard")}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PeekSide({
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
            <PeekAttachment key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PeekAttachment({ attachment }: { attachment: CardAttachmentDto }) {
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
    <span className={cn("flex h-16 w-24 items-center justify-center overflow-hidden rounded-lg bg-canvas-sunken shadow-[0_0_0_1px_var(--line-soft)]")}>
      <img
        src={url}
        alt={attachment.displayName}
        title={attachment.caption ?? attachment.displayName}
        className="max-h-full max-w-full object-contain"
      />
    </span>
  )
}
