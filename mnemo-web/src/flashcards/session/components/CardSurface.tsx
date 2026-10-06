import type { CSSProperties, MouseEvent } from "react"

import type { CardDto } from "@/api/types"
import { cn } from "@/lib/utils"
import { useSettingValue } from "@/settings/store"

import { CardText } from "../../CardText"
import { occlusionOf } from "../../occlusion/card"
import { OcclusionSurface } from "../../occlusion/OcclusionSurface"
import { answerText, promptText } from "../../study"
import { AttachmentCarousel } from "./AttachmentCarousel"
import { isCardActionClick } from "./card-click"
import { CardCorner } from "./CardCorner"

export interface CardSurfaceProps {
  card: CardDto
  revealed: boolean
  canUndo: boolean
  /** View state of an image occlusion card's masks; the page owns it so the M key can reach it. */
  showMasks?: boolean
  onToggleMasks?: () => void
  onReveal: () => void
  onEdit: () => void
  onFlag: () => void
  onUndo: () => void
}

/** Picks the surface for the card: image occlusion has its own, everything else shares one. */
export function CardSurface(props: CardSurfaceProps) {
  const occlusion = occlusionOf(props.card)
  if (occlusion) return <OcclusionSurface key={props.card.id} {...props} occlusion={occlusion} />
  return <PlainCardSurface {...props} />
}

/**
 * The prompt, the corner actions and, once revealed, the answer. A click anywhere but a button
 * reveals, checked here rather than each button carrying its own stopPropagation.
 */
function PlainCardSurface({ card, revealed, canUndo, onReveal, onEdit, onFlag, onUndo }: CardSurfaceProps) {
  // The desktop's markdown view honours the global size setting; .chat-prose reads its size from
  // this variable, so overriding it here scopes the setting to the card without touching chat.
  const mdSize = useSettingValue("Markdown.FontSize", "16px")
  const proseSize = { "--font-size-body-medium": mdSize } as CSSProperties

  const reveal = (event: MouseEvent<HTMLDivElement>) => {
    if (isCardActionClick(event)) return
    onReveal()
  }

  return (
    <div
      onClick={reveal}
      className={cn(
        "group/card relative flex w-full cursor-pointer flex-col rounded-2xl bg-canvas p-8 shadow-canvas",
      )}
    >
      <CardCorner isFlagged={card.isFlagged} canUndo={canUndo} onEdit={onEdit} onFlag={onFlag} onUndo={onUndo} />

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
