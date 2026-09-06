import { Dialog } from "radix-ui"

import type { CardViewDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"

import { StateTag, cardStateKind } from "../../bits"
import { dueLabel } from "../../deck/cards"
import { CardPeekBody } from "./CardPeekBody"

/**
 * A read-only quick look at one card, opened from the browser without leaving the table.
 *
 * Renders the same way study does - CardText for the body, the deck table's own
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
            <CardPeekBody card={card} />
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

