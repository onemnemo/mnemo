export const PROFILE_COLOURS = [
  {
    id: "default",
    label: "ProfileColourDefault",
    background: "var(--frame-active)",
    foreground: "var(--ink-2)",
  },
  {
    id: "clay",
    label: "ProfileColourClay",
    background: "var(--profile-clay)",
    foreground: "var(--profile-clay-ink)",
  },
  {
    id: "sand",
    label: "ProfileColourSand",
    background: "var(--profile-sand)",
    foreground: "var(--profile-sand-ink)",
  },
  {
    id: "moss",
    label: "ProfileColourMoss",
    background: "var(--profile-moss)",
    foreground: "var(--profile-moss-ink)",
  },
  {
    id: "sky",
    label: "ProfileColourSky",
    background: "var(--profile-sky)",
    foreground: "var(--profile-sky-ink)",
  },
  {
    id: "iris",
    label: "ProfileColourIris",
    background: "var(--profile-iris)",
    foreground: "var(--profile-iris-ink)",
  },
] as const

export type ProfileColour = (typeof PROFILE_COLOURS)[number]["id"]

export const DEFAULT_PROFILE_COLOUR: ProfileColour = "default"

/** Returns a supported colour, including for settings written by a newer build. */
export function profileColour(value: string): ProfileColour {
  return PROFILE_COLOURS.some((colour) => colour.id === value)
    ? (value as ProfileColour)
    : DEFAULT_PROFILE_COLOUR
}

/** Up to two characters, taken from the first and last words. */
export function profileInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "M"

  const first = Array.from(words[0] ?? "")[0] ?? ""
  const last = words.length > 1 ? (Array.from(words.at(-1) ?? "")[0] ?? "") : ""
  return (first + last).toUpperCase()
}
