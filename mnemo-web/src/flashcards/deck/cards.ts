import type { CardViewDto } from "@/api/types"

/** Cards per page. Offset paging, matching the desktop's fixed page size. */
export const PAGE_SIZE = 50

/** Pixel width of the header's retention track. */
export const RETENTION_TRACK_WIDTH = 30

export const SEARCH_DEBOUNCE_MS = 250

// The deck table hides the answer behind a marker rather than showing it, so a
// cloze card's front reads the way it will during review. Note this is NOT the
// same pattern the desktop uses to gate saving a cloze card - that one matches a
// bare "{{c1::" prefix with no closing braces, so a half-typed marker saves fine
// and then renders here unreplaced.
const CLOZE_MARKER = /\{\{c\d+::(.*?)\}\}/g

/**
 * Collapses a card's front into a single line for the table: cloze answers become
 * an ellipsis marker and all whitespace runs become single spaces. Visual
 * truncation is left to CSS so it follows the column's real width.
 */
export function frontPreview(front: string): string {
  return front.replace(CLOZE_MARKER, "[…]").replace(/[\r\n]/g, " ").replace(/\s+/g, " ").trim()
}

export interface DueLabel {
  text: string
  /** Drives the accent colouring; false for suspended cards even if the date has passed. */
  isDue: boolean
}

/**
 * The DUE cell. Suspended cards show a dash: their due date keeps advancing into
 * the past while suspended, so the real number would be alarming and meaningless.
 */
export function dueLabel(
  view: CardViewDto,
  now: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): DueLabel {
  if (view.card.state === "suspended") return { text: "—", isDue: false }

  const due = new Date(view.schedule.dueDate).getTime()
  if (due <= now) return { text: t("DueTodayCompact"), isDue: true }

  const days = Math.max(1, Math.ceil((due - now) / 86_400_000))
  return { text: t("DueInDaysFormat", { 0: days }), isDue: false }
}

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
