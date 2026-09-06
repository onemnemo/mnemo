import type { CSSProperties, KeyboardEvent, ReactNode } from "react"

import type { CardDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"
import { useSettingValue } from "@/settings/store"

import { CardText } from "../../CardText"
import { AttachmentCarousel } from "../../session/components/AttachmentCarousel"
import { answerText, promptText } from "../../study"

/**
 * The test card: the prompt, a box to answer in, and - once revealed - the answer next to what
 * was actually written. Unlike a review card this one never reveals on click; the answer box has
 * the focus and a stray click in it would give the answer away mid-sentence.
 *
 * The typed answer sits on the accent wash and the real answer on plain paper, so self-marking
 * is a glance rather than a re-read of two near-identical paragraphs to find which one is yours.
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
    <div className="group/card relative w-full rounded-2xl p-7 shadow-[0_0_0_1px_var(--line)]" style={proseSize}>
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

      {/* Room kept on the right so a long first line never runs under the corner actions. */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4 pr-16">
        <div className="chat-prose min-w-0 flex-[1_1_17rem] whitespace-pre-wrap" data-selectable>
          <CardText>{promptText(card)}</CardText>
        </div>
        <AttachmentCarousel key={`${card.id}-front`} attachments={card.attachments} side="front" />
      </div>

      <Rule label={fc("TestYourAnswerLabel")} />

      {!revealed ? (
        <textarea
          // Keyed on the card so each one starts with the box focused, the way the desktop
          // focuses it every time a card is presented.
          key={card.id}
          autoFocus
          value={answer}
          onChange={(event) => onAnswerChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder={fc("TestAnswerPlaceholder")}
          className={cn(
            "w-full resize-none rounded-xl bg-transparent px-3.5 py-3",
            "text-[14.5px] leading-[1.6] text-ink placeholder:text-ink-3",
            "shadow-[0_0_0_1px_var(--line)] focus:shadow-[0_0_0_1.5px_var(--accent)] focus:outline-none",
          )}
        />
      ) : answer.trim() ? (
        <p className="rounded-xl bg-accent-wash px-3.5 py-3 text-[14.5px] leading-[1.6] whitespace-pre-wrap text-ink shadow-[0_0_0_1px_var(--line-soft)] dark:bg-accent-wash/40">
          {answer}
        </p>
      ) : (
        <p className="rounded-xl px-3.5 py-3 text-[13.5px] text-ink-3 shadow-[0_0_0_1px_var(--line-soft)]">
          {fc("TestAnswerBlank")}
        </p>
      )}

      {revealed && (
        <div className="animate-rise">
          <Rule label={fc("TestCorrectAnswerLabel")} />
          <div className="flex items-start">
            <div className="chat-prose mr-3.5 min-w-0 flex-1 whitespace-pre-wrap" data-selectable>
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
        </div>
      )}
    </div>
  )
}

/** A labelled rule. The label is the only thing naming which half you are reading. */
function Rule({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-line-soft" />
      <span className="text-[10.5px] font-medium tracking-[0.09em] text-ink-3 uppercase">{label}</span>
      <span className="h-px flex-1 bg-line-soft" />
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
