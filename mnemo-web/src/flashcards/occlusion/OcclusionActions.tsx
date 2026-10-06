import { useT } from "@/i18n/useT"

import { CardAction } from "../session/components/CardCorner"

/** The image controls at the head of the card's corner: Show masks (hide all only), Zoom in, Fit while zoomed. */
export function OcclusionActions({
  canShowMasks,
  showMasks,
  onToggleMasks,
  zoomed,
  canZoomIn,
  onZoomIn,
  onFit,
}: {
  canShowMasks: boolean
  showMasks: boolean
  onToggleMasks: () => void
  zoomed: boolean
  canZoomIn: boolean
  onZoomIn: () => void
  onFit: () => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)

  return (
    <>
      {canShowMasks && <CardAction icon="eye" label={fc("StudyShowMasks")} pressed={showMasks} onClick={onToggleMasks} />}
      <CardAction icon="zoom-in" label={fc("StudyZoomIn")} disabled={!canZoomIn} onClick={onZoomIn} />
      {zoomed && <CardAction icon="maximize" label={fc("StudyFit")} active onClick={onFit} />}
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
    </>
  )
}
