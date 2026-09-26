export const LINE_HIT_WIDTH = 14

export function bendRingLook(bent: boolean): { fill: string; fillOpacity: number } {
  return bent ? { fill: "var(--canvas)", fillOpacity: 1 } : { fill: "var(--accent)", fillOpacity: 0.35 }
}
