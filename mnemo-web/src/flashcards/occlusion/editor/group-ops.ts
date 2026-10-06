import { buildOcclusionUnits, type OcclusionDocument, type OcclusionMask } from "../../facts/occlusion"
import { normalizeOrder } from "./cards"
import type { OpResult } from "./ops"

/**
 * Merges the cards the given masks belong to into one group, labelled by the first card's id or
 * group so the key of whichever came first survives. Fewer than two cards comes back unchanged.
 */
export function groupMasks(document: OcclusionDocument, ids: readonly string[]): OpResult {
  const wanted = new Set(ids)
  const picked = buildOcclusionUnits(document).units.filter((unit) => unit.members.some((mask) => wanted.has(mask.id)))
  if (picked.length < 2) return { document, ids: [] }

  const lead = picked[0].members[0]
  const label = lead.group ?? lead.id
  const members = new Set(picked.flatMap((unit) => unit.members.map((mask) => mask.id)))
  const merged = {
    ...document,
    masks: document.masks.map((mask) => (members.has(mask.id) ? { ...mask, group: label } : mask)),
  }

  // The merged card sits where its first member did, and its members are made contiguous.
  const placed = [...merged.masks].sort((a, b) => a.order - b.order)
  const firstAt = placed.findIndex((mask) => members.has(mask.id))
  const before = placed.slice(0, firstAt).filter((mask) => !members.has(mask.id))
  const after = placed.slice(firstAt).filter((mask) => !members.has(mask.id))
  const inside = placed.filter((mask) => members.has(mask.id))
  const masks = [...before, ...inside, ...after].map((mask, index) => ({ ...mask, order: index }))

  return { document: normalizeOrder({ ...merged, masks }), ids: inside.map((mask) => mask.id) }
}

function takesLabel(document: OcclusionDocument, lowest: OcclusionMask, label: string): boolean {
  return lowest.id !== label && !document.masks.some((mask) => mask.id === label)
}

/**
 * Dissolves the groups the given masks belong to. The first member takes the group label as its id
 * when nothing else uses it, so it keeps the card and its history; the others become cards again.
 */
export function ungroupMasks(document: OcclusionDocument, ids: readonly string[]): OpResult {
  const wanted = new Set(ids)
  const labels = new Set<string>()
  for (const mask of document.masks) {
    if (wanted.has(mask.id) && mask.group) labels.add(mask.group)
  }
  if (labels.size === 0) return { document, ids: [] }

  // Settle the card order first, so a group does not scatter to where its later members were stored.
  const settled = normalizeOrder(document)
  const ungrouped = new Set<string>()
  let masks = settled.masks
  for (const label of labels) {
    const members = masks.filter((mask) => mask.group === label).sort((a, b) => a.order - b.order)
    const lowest = members[0]
    const rename = takesLabel({ ...settled, masks }, lowest, label)
    for (const member of members) ungrouped.add(rename && member === lowest ? label : member.id)
    masks = masks.map((mask) => {
      if (mask.group !== label) return mask
      const { group: _group, ...rest } = mask
      return rename && mask === lowest ? { ...rest, id: label } : rest
    })
  }

  return { document: { ...settled, masks }, ids: [...ungrouped] }
}
