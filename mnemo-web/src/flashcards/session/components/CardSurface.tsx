import type { CSSProperties, MouseEvent, ReactNode } from "react"

import type { CardDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { useSettingValue } from "@/settings/store"

import { CardText } from "../../CardText"
import { answerText, promptText } from "../../study"
import { AttachmentCarousel } from "./AttachmentCarousel"

/**
 * The card, which is the screen: prompt, the actions in its corner, and - once revealed - the
 * answer under a plain rule. Clicking anywhere that is not a button reveals, so the buttons are
 * checked for rather than each carrying its own stopPropagation.
 *
 * The corner actions stay hidden until the pointer is over the card, except the flag, which
 * pins them open once it is set: a card's own state has to be visible without hunting for it.
 */
export function CardSurface({
  card,
  revealed,
  canUndo,
  onReveal,
  onEdit,
  onFlag,
  onUndo,
}: {
  card: CardDto
  revealed: boolean
  canUndo: boolean
  onReveal: () => void
  onEdit: () => void
  onFlag: () => void
  onUndo: () => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)
  // The desktop's markdown view honours the global size setting; .chat-prose reads its size from
  // this variable, so overriding it here scopes the setting to the card without touching chat.
  const mdSize = useSettingValue("Markdown.FontSize", "16px")
  const proseSize = { "--font-size-body-medium": mdSize } as CSSProperties

  const reveal = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) return
    onReveal()
  }

  return (
    <div
      onClick={reveal}
      className={cn(
        "group/card relative flex w-full cursor-pointer flex-col rounded-2xl bg-canvas p-8 shadow-canvas",
      )}
    >
      <div
        className={cn(
          "absolute top-3 right-3 flex items-center gap-0.5 transition-opacity",
          card.isFlagged ? "opacity-100" : "opacity-0 group-hover/card:opacity-100 focus-within:opacity-100",
        )}
      >
        <CardAction icon="flyout/rename" label={fc("StudyEdit")} onClick={onEdit} />
        <button
          type="button"
          aria-label={fc("StudyFlag")}
          aria-pressed={card.isFlagged}
          title={fc("StudyFlag")}
          onClick={onFlag}
          className={cn(
            "grid size-7 cursor-pointer place-items-center rounded-md transition-colors",
            card.isFlagged
              ? "text-state-due hover:bg-frame-hover [&>svg]:fill-current"
              : "text-ink-3 hover:bg-frame-hover hover:text-ink",
          )}
        >
          <AppIcon name="common/flag" size={15} />
        </button>
        <CardAction icon="common/undo" label={fc("StudyUndo")} onClick={onUndo} disabled={!canUndo} />
      </div>

      <div style={proseSize}>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <div className="chat-prose min-w-0 flex-[1_1_17rem] whitespace-pre-wrap" data-selectable>
            <CardText>{promptText(card)}</CardText>
          </div>
          <AttachmentCarousel key={`${card.id}-front`} attachments={card.attachments} side="front" />
        </div>

        {revealed && (
          <>
            <div className="my-6 h-px bg-line-soft" />
            <div className="animate-rise flex flex-wrap items-start gap-x-6 gap-y-4">
              <div className="chat-prose min-w-0 flex-[1_1_17rem] whitespace-pre-wrap" data-selectable>
                {/* Paragraphs, not one block: an answer can carry more than the answer itself,
                    and the blank line between them is the only signal that survives typing. */}
                {answerText(card)
                  .split(/\n{2,}/)
                  .map((para, i) => (
                    <CardText key={i}>{para}</CardText>
                  ))}
              </div>
              <AttachmentCarousel key={`${card.id}-back`} attachments={card.attachments} side="back" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CardAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 cursor-pointer place-items-center rounded-md text-ink-3 transition-colors",
        "hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30",
      )}
    >
      <AppIcon name={icon} size={15} />
    </button>
  )
}
