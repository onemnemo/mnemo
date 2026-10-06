import {
  buildOcclusionUnits,
  occlusionLabelOf,
  type OcclusionDocument,
  type OcclusionMask,
  type OcclusionUnit,
} from "../../facts/occlusion"

/** One card the document makes: a single mask or a group, with the number shown on its badge. */
export interface CardEntry {
  key: string
  /** Position in card order, from 1. Presentation only, never part of the key. */
  number: number
  /** Member mask ids in member order. */
  ids: string[]
  /** The members' labels joined, empty when none has one. */
  label: string
  grouped: boolean
  /** The group label, when grouped. */
  group?: string
}

function entryOf(unit: OcclusionUnit, number: number): CardEntry {
  const group = unit.members[0].group
  return {
    key: unit.key,
    number,
    ids: unit.members.map((mask) => mask.id),
    label: occlusionLabelOf(unit),
    grouped: unit.members.length > 1 || Boolean(group),
    ...(group ? { group } : {}),
  }
}

/** The cards in order. Built by the same function the generator uses, so the two always agree. */
export function cardList(document: OcclusionDocument): CardEntry[] {
  return buildOcclusionUnits(document).units.map((unit, index) => entryOf(unit, index + 1))
}

/** The card a mask belongs to. */
export function cardOf(cards: readonly CardEntry[], maskId: string): CardEntry | undefined {
  return cards.find((card) => card.ids.includes(maskId))
}

/** Every mask of the cards the given masks belong to, in card order. A mask no card claims stands for itself. */
export function expandToCards(document: OcclusionDocument, ids: readonly string[]): string[] {
  const wanted = new Set(ids)
  const out: string[] = []
  for (const card of cardList(document)) {
    if (card.ids.some((id) => wanted.has(id))) out.push(...card.ids)
  }
  for (const mask of unclaimed(document)) {
    if (wanted.has(mask.id)) out.push(mask.id)
  }
  return out
}

/** How many cards the given masks span, which is what align and distribute count. */
export function cardCountOf(document: OcclusionDocument, ids: readonly string[]): number {
  const wanted = new Set(ids)
  const cards = cardList(document).filter((card) => card.ids.some((id) => wanted.has(id))).length
  return cards + unclaimed(document).filter((mask) => wanted.has(mask.id)).length
}

/** Whether the ids are exactly the members of one group, which may be down to a single mask. */
export function isExactlyOneGroup(document: OcclusionDocument, ids: readonly string[]): boolean {
  if (ids.length < 1) return false
  const cards = cardList(document).filter((card) => card.ids.some((id) => ids.includes(id)))
  return cards.length === 1 && cards[0].grouped && cards[0].ids.length === ids.length
}

/** Masks in a unit the generator dropped for a key clash. They stay editable so they can be removed. */
function unclaimed(document: OcclusionDocument): OcclusionMask[] {
  const claimed = new Set(cardList(document).flatMap((card) => card.ids))
  return document.masks.filter((mask) => !claimed.has(mask.id)).sort((a, b) => a.order - b.order)
}

/** The masks in the order the stage draws them: card order, then any unclaimed masks. */
export function drawOrder(document: OcclusionDocument): OcclusionMask[] {
  const byId = new Map(document.masks.map((mask) => [mask.id, mask]))
  const out: OcclusionMask[] = []
  for (const card of cardList(document)) {
    for (const id of card.ids) {
      const mask = byId.get(id)
      if (mask) out.push(mask)
    }
  }
  return [...out, ...unclaimed(document)]
}

/** Gives every mask a distinct `order` that follows the cards, each group's members side by side. */
export function normalizeOrder(document: OcclusionDocument): OcclusionDocument {
  const byId = new Map(document.masks.map((mask) => [mask.id, mask]))
  const masks = drawOrder(document).map((mask, index) => ({ ...mask, order: index }))
  const unchanged = masks.every((mask) => byId.get(mask.id)?.order === mask.order)
  return unchanged ? document : { ...document, masks }
}
