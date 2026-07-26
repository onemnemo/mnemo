/**
 * Reading a committed CSS transform back as a camera.
 *
 * Shared because it is the commit half of every viewport proof, and the two arms must answer
 * it the same way or the proof is comparing a state to a different coordinate system rather
 * than to what actually painted.
 */

import type { Viewport } from '../../harness/contract'

/**
 * Parses `matrix(a, b, c, d, e, f)` off an element's committed transform and converts it into
 * the contract's camera units: the canvas coordinate sitting at the viewport's top-left.
 *
 * Returns null rather than a default when there is nothing parseable, because a fabricated
 * identity viewport would read as a transform that agrees with any state at the origin.
 */
export function parseCommittedTransform(el: HTMLElement | null): Viewport | null {
  if (!el) return null
  const value = getComputedStyle(el).transform
  if (!value || value === 'none') return null
  const match = /matrix\(([^)]+)\)/.exec(value)
  if (!match?.[1]) return null
  const parts = match[1].split(',').map((p) => Number.parseFloat(p.trim()))
  if (parts.length < 6 || parts.some(Number.isNaN)) return null
  const zoom = parts[0] as number
  const translateX = parts[4] as number
  const translateY = parts[5] as number
  if (zoom === 0) return null
  return { x: -translateX / zoom, y: -translateY / zoom, zoom }
}
