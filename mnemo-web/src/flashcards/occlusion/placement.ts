import type { OcclusionMaskDto } from "@/api/types"

/** How a mask is drawn: covered, the one being asked, the revealed answer, or outlined for Show masks. */
export type MaskState = "covered" | "asked" | "answer" | "shown"

export interface PlacedMask {
  mask: OcclusionMaskDto
  state: MaskState
}

/** Which masks are drawn and how: hide one shows only the asked masks, hide all shows every one. */
export function placeMasks(
  masks: OcclusionMaskDto[],
  askedIds: string[],
  mode: "hideAll" | "hideOne",
  side: "front" | "back",
  showMasks: boolean,
): PlacedMask[] {
  const asked = new Set(askedIds)
  const placed: PlacedMask[] = []
  for (const mask of masks) {
    if (asked.has(mask.id)) {
      placed.push({ mask, state: side === "back" ? "answer" : "asked" })
    } else if (mode === "hideAll") {
      const state: MaskState = showMasks ? "shown" : "covered"
      placed.push({ mask, state })
    }
  }
  return placed
}
