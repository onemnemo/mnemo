import type { OcclusionDocument } from "../../facts/occlusion"
import { computeAlign, DISTRIBUTE_MIN, ALIGN_MIN, type AlignOp } from "@/mindmap/edit/align"

import { cardList } from "./cards"
import { shifted, unionBox } from "./shape"

export type { AlignOp }

/** Align needs two cards. */
export function canAlign(cardCount: number): boolean {
  return cardCount >= ALIGN_MIN
}

/** Distribute needs three, because the outer two stay where they are. */
export function canDistribute(cardCount: number): boolean {
  return cardCount >= DISTRIBUTE_MIN
}

/**
 * Aligns or distributes the cards the given masks belong to. A group is one box, so its members
 * keep their layout and move together; a polygon travels with its box.
 */
export function alignMasks(document: OcclusionDocument, ids: readonly string[], op: AlignOp): OcclusionDocument {
  const wanted = new Set(ids)
  const byId = new Map(document.masks.map((mask) => [mask.id, mask]))
  const cards = cardList(document)
    .map((card) => ({ key: card.key, members: card.ids.map((id) => byId.get(id)!).filter(Boolean) }))
    .filter((card) => card.members.some((mask) => wanted.has(mask.id)))

  const boxes = cards.map((card) => {
    const box = unionBox(card.members)
    return { id: card.key, x: box.x, y: box.y, width: box.w, height: box.h }
  })
  const moves = new Map(computeAlign(op, boxes).map((move) => [move.id, move]))
  if (moves.size === 0) return document

  const deltas = new Map<string, [number, number]>()
  for (const card of cards) {
    const move = moves.get(card.key)
    const box = boxes.find((b) => b.id === card.key)!
    if (!move) continue
    // Rounding a moved edge must not push the card past the image.
    const dx = Math.min(Math.max(move.x - box.x, -box.x), 1 - box.x - box.width)
    const dy = Math.min(Math.max(move.y - box.y, -box.y), 1 - box.y - box.height)
    for (const mask of card.members) deltas.set(mask.id, [dx, dy])
  }

  let changed = false
  const masks = document.masks.map((mask) => {
    const delta = deltas.get(mask.id)
    if (!delta) return mask
    const next = shifted(mask, delta[0], delta[1])
    if (next.x === mask.x && next.y === mask.y) return mask
    changed = true
    return next
  })
  return changed ? { ...document, masks } : document
}
