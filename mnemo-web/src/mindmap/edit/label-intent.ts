/**
 * Labels that open with an empty equation in them, by element id. Held until the edit ends rather
 * than taken on open, so a field opened twice by strict mode gets it both times.
 */
const pending = new Set<string>()

export function openWithEquation(id: string): void {
  pending.add(id)
}

export function opensWithEquation(id: string): boolean {
  return pending.has(id)
}

export function forgetOpenIntent(id: string): void {
  pending.delete(id)
}
