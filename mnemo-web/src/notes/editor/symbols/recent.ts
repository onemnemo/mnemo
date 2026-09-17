/**
 * The symbols this user reached for last, most recent first, by LaTeX name.
 *
 * Kept in localStorage rather than behind the API, the same as the emoji
 * picker's recent row: it is a convenience list with no meaning outside this
 * machine's palette, and putting it on the server would mean a settings key,
 * an endpoint and a round trip before the menu can open. Nothing breaks when
 * it is missing, so a browser that refuses storage simply shows no Recent
 * group.
 */

const STORAGE_KEY = 'mnemo.symbols.recent';

/** Enough to cover a working session's vocabulary without pushing the groups off the first screen. */
export const RECENT_SYMBOL_LIMIT = 8;

export function readRecentSymbols(): readonly string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    // Anything else was written by something other than this module, so it is
    // treated as absent rather than trusted.
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .slice(0, RECENT_SYMBOL_LIMIT);
  } catch {
    return [];
  }
}

/** Moves `name` to the front and returns the new list, so callers can render without re-reading. */
export function rememberSymbol(name: string): readonly string[] {
  const next = [name, ...readRecentSymbols().filter((value) => value !== name)].slice(
    0,
    RECENT_SYMBOL_LIMIT,
  );
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store costs the user their history, not their pick.
  }
  return next;
}
