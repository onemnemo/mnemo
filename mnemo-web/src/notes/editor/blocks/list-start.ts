/**
 * The number a run of numbered items starts at.
 *
 * Only the run's first item stores it, under `listStart`, and only when it is
 * not 1; every later item shows the start plus its place. The per-item numbers
 * older imports wrote under other keys are never read, so a note from before
 * shows the numbers it always showed.
 */

export const LIST_START_KEY = 'listStart';

const LARGEST_START = 999_999_999;

/** The start an item stores, or null when it stores none a list can start at. */
export function storedListStart(meta: unknown): number | null {
  if (meta === null || typeof meta !== 'object') return null;
  const value = (meta as Record<string, unknown>)[LIST_START_KEY];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= LARGEST_START ? value : null;
}

/**
 * The start a run opened by an item with this meta counts from, `depth` list
 * levels down. A 0 counts only at a decimal depth, since letter and roman
 * labels have no zero.
 */
export function listStartOf(meta: unknown, depth: number): number {
  const stored = storedListStart(meta);
  if (stored === null) return 1;
  return stored === 0 && depth % 3 !== 0 ? 1 : stored;
}

/**
 * `meta` with its start replaced, or removed for null and for 1, the default.
 * A new object, as every write to `meta` has to be.
 */
export function withListStart(meta: unknown, start: number | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...((meta as Record<string, unknown> | null) ?? {}) };
  if (start === null || start === 1) delete next[LIST_START_KEY];
  else next[LIST_START_KEY] = start;
  return next;
}
