import type { CSSProperties, KeyboardEvent, ReactNode } from "react"

import type { CardDto } from "@/api/types"
import { Markdown } from "@/chat/components/Markdown"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { useSettingValue } from "@/settings/store"

import { AttachmentCarousel } from "../../session/components/AttachmentCarousel"
import { answerText, promptText } from "../../study"

/**
 * The test card: the prompt, a box to answer in, and - once revealed - the answer next to what
 * was actually written. Unlike a review card this one never reveals on click; the answer box has
 * the focus and a stray click in it would give the answer away mid-sentence.
 */
export function TestCard({
  card,
  answer,
  revealed,
  canUndo,
  onAnswerChange,
  onReveal,
  onEdit,
  onFlag,
  onUndo,
}: {
  card: CardDto
  answer: string
  revealed: boolean
  canUndo: boolean
  onAnswerChange: (text: string) => void
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

  // Enter reveals, as it does on the desktop, so the reader never has to reach for the mouse.
  // Shift+Enter is left alone for a multi-line answer.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    onReveal()
  }

  return (
    // 780 wide as on the desktop, but allowed to shrink: the desktop clips a card too wide for its
    // window, which in a resizable browser pane would simply hide the text.
    <div className="flex max-h-[600px] min-h-[320px] w-[780px] max-w-full flex-col rounded-lg border border-line bg-card shadow-[0_16px_40px_-24px_rgba(0,0,0,0.25)]">
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
        <Markdown content={promptText(card)} />

        <Divider label={fc("TestYourAnswerLabel")} className="mt-[22px] mb-2.5" />

        {revealed ? (
          <div className="rounded-md border border-line bg-[var(--accent-subtle-background)] px-3 py-2.5 whitespace-pre-wrap">
            {answer}
          </div>
        ) : (
          <textarea
            // Keyed on the card so each one starts with the box focused, the way the desktop
            // focuses it every time a card is presented.
            key={card.id}
            autoFocus
            value={answer}
            onChange={(event) => onAnswerChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={fc("TestAnswerPlaceholder")}
            className={cn(
              "min-h-20 w-full resize-y rounded-md border border-line bg-[var(--widget-background-primary)]",
              "px-3 py-2.5 outline-none focus:border-[var(--accent)]",
            )}
          />
        )}

        {revealed && (
          <>
            <Divider label={fc("TestCorrectAnswerLabel")} className="mt-[22px] mb-3.5" />
            <div className="flex items-start">
              <div className="mr-3.5 min-w-0 flex-1">
                <Markdown content={answerText(card)} />
              </div>
              <AttachmentCarousel key={`${card.id}-back`} attachments={card.attachments} side="back" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** A micro label between two hairlines, as the desktop draws its section breaks. */
function Divider({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex items-center", className)}>
      <span className="h-px flex-1 bg-[var(--line-color)]" />
      <span className="mx-2.5 font-semibold text-caption tracking-[1.2px] text-text-faded">{label}</span>
      <span className="h-px flex-1 bg-[var(--line-color)]" />
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
