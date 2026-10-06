import type { CardDto, OcclusionDto, OcclusionMaskDto } from "@/api/types"

import { plainCardText } from "../card-format"

/** The occlusion payload of a card that review can draw, or null for an ordinary card. */
export function occlusionOf(card: CardDto): (OcclusionDto & { imageAssetId: string }) | null {
  const payload = card.occlusion
  if (!payload || !payload.imageAssetId) return null
  return payload as OcclusionDto & { imageAssetId: string }
}

/** Whether the Show masks control and key apply: only hide all has other masks to reveal. */
export function canShowMasks(card: CardDto | null | undefined): boolean {
  return !!card && occlusionOf(card)?.mode === "hideAll"
}

/** The masks this card asks, in mask order. */
export function askedMasks(payload: OcclusionDto): OcclusionMaskDto[] {
  const asked = new Set(payload.askedIds)
  return payload.masks.filter((mask) => asked.has(mask.id))
}

/** The 1-based badge number of the first asked mask, which is the number the editor shows for the card. */
export function cardNumber(payload: OcclusionDto): number {
  const first = payload.masks.findIndex((mask) => payload.askedIds.includes(mask.id))
  return first < 0 ? 1 : first + 1
}

const TRAILING_STOPS = /[.:;!?]+$/
const NAME_LIMIT = 80

/** A short plain name for the image in an accessible label: the question, trimmed to a line. */
export function imageName(front: string, fallback: string): string {
  const line = plainCardText(front).replace(/\s+/g, " ").trim().replace(TRAILING_STOPS, "")
  if (!line) return fallback
  return line.length > NAME_LIMIT ? `${line.slice(0, NAME_LIMIT).trimEnd()}…` : line
}
