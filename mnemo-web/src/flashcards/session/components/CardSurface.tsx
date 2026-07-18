import type { CSSProperties, MouseEvent, ReactNode } from "react"

import type { CardDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { Markdown } from "@/chat/components/Markdown"
import { useSettingValue } from "@/settings/store"

import { answerText, promptText } from "../session"
import { AttachmentCarousel } from "./AttachmentCarousel"

/**
 * The card itself: prompt, the actions in its corner, and - once revealed - the answer. Clicking
 * anywhere that is not a button reveals, which is why the buttons are checked for rather than
 * given their own stopPropagation.
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
  const mdSize = useSettingValue<string>("Markdown.FontSize", "16px")
  const proseSize = { "--font-size-body-medium": mdSize } as CSSProperties

  const reveal = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) return
    onReveal()
  }

  return (
    // 780 wide as on the desktop, but allowed to shrink: the desktop clips a card too wide for its
    // window, which in a resizable browser pane would simply hide the text.
    <div
      onClick={reveal}
      className="flex max-h-[560px] min-h-[320px] w-[780px] max-w-full flex-col rounded-lg border border-line bg-card shadow-[0_16px_40px_-24px_rgba(0,0,0,0.25)]"
    >
      <div className="mt-2.5 mr-2.5 flex shrink-0 items-center justify-end gap-0.5">
        <CardAction icon="flyout/rename" label={fc("StudyEdit")} onClick={onEdit} />
        <CardAction
          icon="common/flag"
          label={fc("StudyFlag")}
          onClick={onFlag}
          className={card.isFlagged ? "text-brand" : undefined}
        />
        <CardAction icon="common/undo" label={fc("StudyUndo")} onClick={onUndo} disabled={!canUndo} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[34px] pt-1 pb-[30px]" style={proseSize}>
        <div className="flex flex-col gap-3.5">
          <Markdown content={promptText(card)} />
          <AttachmentCarousel key={`${card.id}-front`} attachments={card.attachments} side="front" />
        </div>

        {revealed && (
          <div className="flex flex-col gap-3.5">
            <div className="mt-[22px] mb-1 flex items-center">
              <span className="h-px flex-1 bg-[var(--line-color)]" />
              <span className="mx-2.5 font-semibold text-caption tracking-[1.2px] text-text-faded">
                {fc("StudyAnswerLabel")}
              </span>
              <span className="h-px flex-1 bg-[var(--line-color)]" />
            </div>

            <div className="flex items-start">
              <div className="min-w-0 flex-1 mr-3.5">
                <Markdown content={answerText(card)} />
              </div>
              <AttachmentCarousel key={`${card.id}-back`} attachments={card.attachments} side="back" />
            </div>
          </div>
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
  className,
}: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
  className?: string
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 cursor-pointer place-items-center rounded-sm text-text-tertiary",
        "hover:bg-[var(--button-background-pointer-over)] disabled:pointer-events-none disabled:opacity-30",
        className,
      )}
    >
      <AppIcon name={icon} size={15} />
    </button>
  )
}
