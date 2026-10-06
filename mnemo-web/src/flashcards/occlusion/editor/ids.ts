import { OCCLUSION_MAX_MASKS, type OcclusionDocument } from "../../facts/occlusion"

/** Mask ids are at least this many random characters. */
export const ID_LENGTH = 8

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

/** Produces a fresh id each call, never one the document or the session has already used. */
export type Mint = () => string

/** Ids and group labels in use. A new id must avoid both because either becomes part of a card key. */
export function takenIds(document: OcclusionDocument): Set<string> {
  const taken = new Set<string>()
  for (const mask of document.masks) {
    taken.add(mask.id)
    if (mask.group) taken.add(mask.group)
  }
  return taken
}

function cryptoRandom(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
  }
  return Math.random()
}

/**
 * A minter over a document. `retired` holds ids the session has already seen, so an id of a deleted
 * mask is not handed out again.
 */
export function createMinter(
  document: OcclusionDocument,
  retired: Iterable<string> = [],
  random: () => number = cryptoRandom,
): Mint {
  const taken = takenIds(document)
  for (const id of retired) taken.add(id)

  return () => {
    for (;;) {
      let id = ""
      for (let i = 0; i < ID_LENGTH; i++) id += ALPHABET[Math.min(ALPHABET.length - 1, Math.floor(random() * ALPHABET.length))]
      if (!taken.has(id)) {
        taken.add(id)
        return id
      }
    }
  }
}

/** Whether another mask still fits under the cap. */
export function roomForMasks(document: OcclusionDocument, count = 1): boolean {
  return document.masks.length + count <= OCCLUSION_MAX_MASKS
}
