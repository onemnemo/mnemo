import type { OcclusionDocument, OcclusionMask } from "../../facts/occlusion"

/** A rectangle mask with the given extras, ordered by its place in the list unless told otherwise. */
export function rect(id: string, x: number, y: number, w: number, h: number, extra: Partial<OcclusionMask> = {}): OcclusionMask {
  return { id, shape: "rect", x, y, w, h, order: 0, ...extra }
}

/** A document whose masks are numbered in the order given, unless a mask sets its own `order`. */
export function makeDoc(...masks: OcclusionMask[]): OcclusionDocument {
  return { mode: "hideAll", masks: masks.map((mask, index) => ({ ...mask, order: mask.order || index })) }
}

/** Three small masks side by side, ids `a`, `b` and `c`. */
export function trio(): OcclusionDocument {
  return makeDoc(rect("a", 0.1, 0.1, 0.1, 0.1), rect("b", 0.4, 0.2, 0.1, 0.1), rect("c", 0.7, 0.3, 0.1, 0.1))
}

/** Ids of the masks in card order. */
export function idsInOrder(document: OcclusionDocument): string[] {
  return [...document.masks].sort((a, b) => a.order - b.order).map((mask) => mask.id)
}

/** A key press as the browser delivers it. */
export function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key
  return new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...init })
}

/** A random source that walks a fixed list, repeating it. */
export function sequence(values: number[]): () => number {
  let at = 0
  return () => values[at++ % values.length]
}
