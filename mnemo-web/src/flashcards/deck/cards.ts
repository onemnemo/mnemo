import type { CardViewDto } from "@/api/types"

/** Cards per page. Offset paging, matching the desktop's fixed page size. */
export const PAGE_SIZE = 50

export const SEARCH_DEBOUNCE_MS = 250

// The deck table hides the answer behind a marker rather than showing it, so a
// cloze card's front reads the way it will during review. Note this is NOT the
// same pattern the desktop uses to gate saving a cloze card - that one matches a
// bare "{{c1::" prefix with no closing braces, so a half-typed marker saves fine
// and then renders here unreplaced.
const CLOZE_MARKER = /\{\{c\d+::(.*?)\}\}/g

const DAY_MS = 86_400_000

/** One line of whatever a card side holds, with every whitespace run closed up. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * Collapses a card's front into a single line for the table: cloze answers become
 * an ellipsis marker and all whitespace runs become single spaces. Visual
 * truncation is left to CSS so it follows the column's real width.
 */
export function frontPreview(front: string): string {
  return oneLine(front.replace(CLOZE_MARKER, "[…]"))
}

export interface DueLabel {
  text: string
  /** Drives the accent colouring; false for suspended cards even if the date has passed. */
  isDue: boolean
}

/**
 * The DUE cell. Suspended cards show a dash: their due date keeps advancing into
 * the past while suspended, so the real number would be alarming and meaningless.
 *
 * Overdue reads separately from due today. They are the same instruction, but a
 * card six days late is the one worth seeing in a list where everything is owed.
 */
export function dueLabel(
  view: CardViewDto,
  now: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): DueLabel {
  if (view.card.state === "suspended") return { text: "-", isDue: false }

  const diff = new Date(view.schedule.dueDate).getTime() - now
  if (diff <= 0) {
    const overdue = Math.floor(-diff / DAY_MS)
    return overdue >= 1
      ? { text: t("DueOverdueFormat", { 0: overdue }), isDue: true }
      : { text: t("DueToday"), isDue: true }
  }

  const days = Math.ceil(diff / DAY_MS)
  return days === 1 ? { text: t("DueTomorrow"), isDue: false } : { text: t("DueInDaysLongFormat", { 0: days }), isDue: false }
}

/** At and above this many lapses a card is worth calling out: it keeps being forgotten. */
export const LEECH_LAPSES = 3

/**
 * Tri-state for the select-all box. Indeterminate whenever the page is partly
 * selected; the desktop resolves that to "select all" on click rather than
 * clearing, so callers should act on the current state, not the box's next value.
 */
export function selectAllState(pageIds: string[], selected: ReadonlySet<string>): boolean | "indeterminate" {
  if (pageIds.length === 0) return false
  const count = pageIds.filter((id) => selected.has(id)).length
  if (count === 0) return false
  return count === pageIds.length ? true : "indeterminate"
}

/** Inclusive 1-based range of the current page, for the "{0}–{1} of {2}" footer. */
export function pageRange(offset: number, totalCount: number): { first: number; last: number } {
  return {
    first: totalCount === 0 ? 0 : offset + 1,
    last: Math.min(offset + PAGE_SIZE, totalCount),
  }
}
