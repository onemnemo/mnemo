import { memo, useRef, useState, type CSSProperties, type MouseEvent } from "react"

import type { OcclusionDto } from "@/api/types"
import { cn } from "@/lib/utils"
import { useSettingValue } from "@/settings/store"

import { CardText } from "../CardText"
import { useCardAsset } from "../editor/assets"
import type { CardSurfaceProps } from "../session/components/CardSurface"
import { isCardActionClick } from "../session/components/card-click"
import { CardCorner } from "../session/components/CardCorner"
import { promptText } from "../study"
import { askedMasks } from "./card"
import { centerOfMasks, FIT_VIEW, MAX_SCALE, ZOOM_STEP, zoomAt, zoomOnto, type View } from "./geometry"
import { useChrome, useColumnRoom, useCompactHeight, useElementSize, useImageLoad } from "./hooks"
import { BOX_HEIGHT_CAP, boxHeight, stageLayout } from "./layout"
import { OcclusionActions } from "./OcclusionActions"
import { OcclusionAnswer } from "./OcclusionAnswer"
import { OcclusionStage } from "./OcclusionStage"
import { useStageLabel } from "./stage-label"

/** The corner bar sits this far from the card edge, and the question keeps clear of it. */
const CORNER_INSET = 12

/**
 * A review card for image occlusion. The card's top is pinned and the answer's height reserved while
 * hidden, so the image never moves on reveal. It sizes from the nearest `data-card-column`.
 */
export function OcclusionSurface({
  card,
  occlusion,
  revealed,
  canUndo,
  showMasks = false,
  onToggleMasks,
  onReveal,
  onEdit,
  onFlag,
  onUndo,
}: CardSurfaceProps & { occlusion: OcclusionDto & { imageAssetId: string } }) {
  const mdSize = useSettingValue("Markdown.FontSize", "16px")
  const proseSize = { "--font-size-body-medium": mdSize } as CSSProperties

  const cardRef = useRef<HTMLDivElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const cornerRef = useRef<HTMLDivElement | null>(null)

  const compact = useCompactHeight()
  const inner = useElementSize(cardRef).w
  const room = useColumnRoom(cardRef)
  const chrome = useChrome(cardRef, rowRef)
  const cornerWidth = useElementSize(cornerRef).w

  const asset = useCardAsset(occlusion.imageAssetId)
  const url = asset.url
  const image = useImageLoad(url, asset.failed)

  const height = boxHeight({ column: room ? room.h : BOX_HEIGHT_CAP + chrome, chrome, compact })
  const { box, fitted } = stageLayout({ natural: image.natural, inner, height, compact })

  const [view, setView] = useState<View>(FIT_VIEW)
  const zoomed = view.scale > 1
  const asked = askedMasks(occlusion)

  const zoomIn = () => {
    if (view.scale >= MAX_SCALE) return
    setView(
      view.scale <= 1
        ? zoomOnto(ZOOM_STEP, centerOfMasks(asked), box, fitted)
        : zoomAt(view, ZOOM_STEP, { x: box.w / 2, y: box.h / 2 }, box, fitted),
    )
  }

  const reveal = (event: MouseEvent<HTMLDivElement>) => {
    if (isCardActionClick(event)) return
    onReveal()
  }

  const label = useStageLabel(card, occlusion, revealed)

  // Built from strings, so a pan that only moves `view` leaves both untouched.
  const answer = <OcclusionAnswer label={card.back} back={occlusion.back} />

  return (
    <div
      ref={cardRef}
      onClick={reveal}
      className="group/card relative flex w-full cursor-pointer flex-col rounded-2xl bg-canvas p-8 shadow-canvas"
    >
      <CardCorner
        isFlagged={card.isFlagged}
        canUndo={canUndo}
        onEdit={onEdit}
        onFlag={onFlag}
        onUndo={onUndo}
        containerRef={cornerRef}
        leading={
          <OcclusionActions
            canShowMasks={occlusion.mode === "hideAll" && onToggleMasks !== undefined}
            showMasks={showMasks}
            onToggleMasks={() => onToggleMasks?.()}
            zoomed={zoomed}
            canZoomIn={view.scale < MAX_SCALE}
            onZoomIn={zoomIn}
            onFit={() => setView(FIT_VIEW)}
          />
        }
      />

      <div style={proseSize}>
        <div
          className="chat-prose pb-4 whitespace-pre-wrap"
          style={{ paddingRight: Math.max(0, cornerWidth + CORNER_INSET) }}
          data-selectable
        >
          <Question text={promptText(card)} />
        </div>

        <div ref={rowRef} className={cn(compact && "flex items-start gap-6")}>
          <OcclusionStage
            masks={occlusion.masks}
            askedIds={occlusion.askedIds}
            mode={occlusion.mode}
            side={revealed ? "back" : "front"}
            showMasks={showMasks}
            imageUrl={url}
            image={image}
            box={box}
            fitted={fitted}
            view={view}
            onViewChange={setView}
            label={label}
          />
          {compact && revealed && (
            <div className="animate-rise min-w-0 flex-1 self-stretch border-l border-line-soft pl-6">{answer}</div>
          )}
        </div>

        {!compact && (
          <div aria-hidden={!revealed} className={cn(!revealed && "invisible")}>
            <div className="my-6 h-px bg-line-soft" />
            <div className={cn(revealed && "animate-rise")}>{answer}</div>
          </div>
        )}
      </div>
    </div>
  )
}

const Question = memo(function Question({ text }: { text: string }) {
  return <CardText>{text}</CardText>
})
