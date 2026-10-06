import type { OcclusionDocument } from "../../facts/occlusion"
import { cardList, drawOrder, expandToCards } from "./cards"

export type SelectMode = "replace" | "add" | "toggle"

export function selectAll(document: OcclusionDocument): string[] {
  return drawOrder(document).map((mask) => mask.id)
}

/** Ids that still exist, in the order given. */
export function pruneSelection(document: OcclusionDocument, ids: readonly string[]): string[] {
  const alive = new Set(document.masks.map((mask) => mask.id))
  return ids.filter((id) => alive.has(id))
}

/**
 * The selection after clicking masks. A click on any member takes the whole group. Toggle removes
 * the group when every member is already selected, otherwise adds it.
 */
export function applySelection(
  document: OcclusionDocument,
  current: readonly string[],
  ids: readonly string[],
  mode: SelectMode,
): string[] {
  const picked = expandToCards(document, ids)
  if (mode === "replace") return picked
  if (mode === "add") return [...new Set([...current, ...picked])]

  const held = new Set(current)
  const allHeld = picked.length > 0 && picked.every((id) => held.has(id))
  return allHeld ? current.filter((id) => !picked.includes(id)) : [...new Set([...current, ...picked])]
}

/**
 * The card before or after the selection, wrapping at the ends. With nothing selected the first
 * card is next and the last is previous.
 */
export function stepCard(document: OcclusionDocument, current: readonly string[], direction: -1 | 1): string[] {
  const cards = cardList(document)
  if (cards.length === 0) return []

  const held = new Set(current)
  const at = cards.map((card, index) => (card.ids.some((id) => held.has(id)) ? index : -1)).filter((index) => index >= 0)
  const from = at.length === 0 ? (direction === 1 ? -1 : cards.length) : direction === 1 ? Math.max(...at) : Math.min(...at)
  const next = (from + direction + cards.length) % cards.length
  return cards[next].ids
}
