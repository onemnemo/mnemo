import type { OcclusionDocument, OcclusionMask } from "../../facts/occlusion"
import { cardList } from "./cards"

/** Rebuilds the order of masks from a new sequence of cards, each group moving as one unit. */
function reorder(document: OcclusionDocument, sequence: readonly (readonly string[])[]): OcclusionDocument {
  const byId = new Map(document.masks.map((mask) => [mask.id, mask]))
  const masks: OcclusionMask[] = []
  for (const ids of sequence) {
    for (const id of ids) {
      const mask = byId.get(id)
      if (mask) masks.push({ ...mask, order: masks.length })
    }
  }
  if (masks.length !== document.masks.length) return document

  const same = masks.every((mask) => byId.get(mask.id)?.order === mask.order)
  return same ? document : { ...document, masks }
}

function sequenceOf(document: OcclusionDocument): string[][] {
  return cardList(document).map((card) => card.ids)
}

function swapping(document: OcclusionDocument, ids: readonly string[], direction: -1 | 1): OcclusionDocument {
  const wanted = new Set(ids)
  const sequence = sequenceOf(document)
  const picked = sequence.map((card) => card.some((id) => wanted.has(id)))
  const indexes = sequence.map((_, i) => i)
  // Walk away from the edge being moved toward, so a selected run slides together and stops at the end.
  if (direction === 1) indexes.reverse()

  for (const i of indexes) {
    const j = i + direction
    if (!picked[i] || j < 0 || j >= sequence.length || picked[j]) continue
    ;[sequence[i], sequence[j]] = [sequence[j], sequence[i]]
    ;[picked[i], picked[j]] = [picked[j], picked[i]]
  }
  return reorder(document, sequence)
}

/** Moves the cards of the given masks one place earlier. A group moves as one card. */
export function moveEarlier(document: OcclusionDocument, ids: readonly string[]): OcclusionDocument {
  return swapping(document, ids, -1)
}

/** Moves the cards of the given masks one place later. */
export function moveLater(document: OcclusionDocument, ids: readonly string[]): OcclusionDocument {
  return swapping(document, ids, 1)
}

/** Moves the card of a mask to a position in card order (from 0), as a drag in the cards list does. */
export function moveCardTo(document: OcclusionDocument, id: string, index: number): OcclusionDocument {
  const sequence = sequenceOf(document)
  const from = sequence.findIndex((card) => card.includes(id))
  if (from < 0) return document

  const [card] = sequence.splice(from, 1)
  sequence.splice(Math.min(Math.max(index, 0), sequence.length), 0, card)
  return reorder(document, sequence)
}
