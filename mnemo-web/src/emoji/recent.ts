/**
 * The emoji this user reached for last, most recent first.
 *
 * Kept in localStorage rather than behind the API: it is a convenience list with
 * no meaning outside this machine's picker, and putting it on the server would
 * mean a settings key, an endpoint and a round trip before the grid can paint.
 * Nothing breaks when it is missing, so a browser that refuses storage simply
 * shows no Recent row.
 */

const STORAGE_KEY = "mnemo.emoji.recent"

/** Two rows at the picker's width. Longer stops being "recent" in any useful sense. */
export const RECENT_LIMIT = 24

export function readRecentEmoji(): readonly string[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return []
  }

  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    // Anything else means the key was written by something other than this module,
    // so treat it as absent rather than trusting it.
    if (!Array.isArray(parsed)) return []

    return parsed.filter((value): value is string => typeof value === "string" && value.length > 0).slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

/** Moves `char` to the front and returns the new list, so callers can render without re-reading. */
export function rememberEmoji(char: string): readonly string[] {
  const next = [char, ...readRecentEmoji().filter((value) => value !== char)].slice(0, RECENT_LIMIT)

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // A full or blocked store costs the user their history, not their pick.
  }

  return next
}
