/**
 * The accent colours a user can pick, in the order the picker shows them. The ids are
 * what persists and what `data-accent` carries; the colours themselves live in
 * styles/tokens.css (the default) and styles/accents.css (the rest).
 */
export const ACCENTS = [
  { id: "terracotta", label: "AccentTerracotta" },
  { id: "amber", label: "AccentAmber" },
  { id: "rose", label: "AccentRose" },
  { id: "plum", label: "AccentPlum" },
  { id: "iris", label: "AccentIris" },
  { id: "indigo", label: "AccentIndigo" },
  { id: "blue", label: "AccentBlue" },
  { id: "teal", label: "AccentTeal" },
  { id: "sage", label: "AccentSage" },
  { id: "graphite", label: "AccentGraphite" },
] as const

export type AccentId = (typeof ACCENTS)[number]["id"]

export const DEFAULT_ACCENT: AccentId = "blue"

/** A stored value as an accent. Anything unrecognised, including absent, is the default. */
export function resolveAccent(value: unknown): AccentId {
  return ACCENTS.find((accent) => accent.id === value)?.id ?? DEFAULT_ACCENT
}
