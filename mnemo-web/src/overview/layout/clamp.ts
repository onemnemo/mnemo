/**
 * Clamp, shared by the placement and targeting math so the two cannot drift apart.
 *
 * `max` wins when `min > max`, which differs from .NET's `Math.Clamp` (that throws). No call site
 * here can reach it: every `max` is derived from an already-clamped span or column count. Stated
 * because it is a real behavioural difference from the code this was ported from, not because
 * anything depends on it.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
