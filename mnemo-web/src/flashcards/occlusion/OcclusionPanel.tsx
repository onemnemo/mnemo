import { useCallback, useRef, useState } from "react"

import type { CardDto, OcclusionDto } from "@/api/types"

import { useCardAsset } from "../editor/assets"
import { FIT_VIEW, type View } from "./geometry"
import { useChrome, useColumnRoom, useElementSize, useImageLoad } from "./hooks"
import { boxHeight, stageLayout } from "./layout"
import { OcclusionStage } from "./OcclusionStage"
import { useStageLabel } from "./stage-label"

/** The image height in a card that is not inside a measured column. */
const PANEL_MAX_HEIGHT = 320

/**
 * The occlusion image on its own, for screens like a test that lay the card out themselves. Inside
 * a `data-card-column` it takes what the column has left, the way a review card does.
 */
export function OcclusionPanel({
  card,
  occlusion,
  revealed,
}: {
  card: CardDto
  occlusion: OcclusionDto & { imageAssetId: string }
  revealed: boolean
}) {
  const host = useRef<HTMLDivElement | null>(null)
  // Found from the panel itself: a child's layout effect runs before the card's own ref is set.
  const cardRef = useRef<HTMLElement | null>(null)
  const attach = useCallback((element: HTMLDivElement | null) => {
    host.current = element
    cardRef.current = element?.closest<HTMLElement>("[data-card-surface]") ?? null
  }, [])
  const inner = useElementSize(host).w
  const room = useColumnRoom(cardRef)
  const measured = useChrome(cardRef, host)
  // A typed answer can make the revealed card taller than its front, so the front's chrome holds the
  // box still. It only holds at the width it was measured at, so a resize after the reveal still fits.
  const [front, setFront] = useState<{ chrome: number; width: number } | null>(null)
  if (!revealed && (front?.chrome !== measured || front.width !== inner)) setFront({ chrome: measured, width: inner })
  const chrome = revealed && front?.width === inner ? front.chrome : measured
  const asset = useCardAsset(occlusion.imageAssetId)
  const url = asset.url
  const image = useImageLoad(url, asset.failed)
  const [view, setView] = useState<View>(FIT_VIEW)

  const height = room ? boxHeight({ column: room.h, chrome, compact: false }) : PANEL_MAX_HEIGHT
  const { box, fitted } = stageLayout({ natural: image.natural, inner, height, compact: false })
  const label = useStageLabel(card, occlusion, revealed)

  return (
    <div ref={attach} className="w-full">
      <OcclusionStage
        masks={occlusion.masks}
        askedIds={occlusion.askedIds}
        mode={occlusion.mode}
        side={revealed ? "back" : "front"}
        showMasks={false}
        imageUrl={url}
        image={image}
        box={box}
        fitted={fitted}
        view={view}
        onViewChange={setView}
        label={label}
      />
    </div>
  )
}
