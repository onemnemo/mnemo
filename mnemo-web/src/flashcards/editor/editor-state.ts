import type { CardType } from "@/api/types"

/** Matches Mnemo.Core's IFlashcardCardService.MaxAttachmentsPerSide. */
export const MAX_ATTACHMENTS_PER_SIDE = 3

/** The formats the host's asset route accepts, as a file-input accept list. */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp"

/**
 * The system cloze grammar, matched head-only the way every other reader of it is. A
 * half-typed `{{c1::` with no closing braces counts as a marker, so a card can be saved
 * mid-thought - and will then render its marker literally in the deck table.
 *
 * Two compiled copies of one pattern, because a /g regex carries a mutable lastIndex: `test`
 * advances it, and `matchAll` starts from wherever it was left. Sharing one instance made the
 * validity check silently move the search window the ordinal scan then ran in, so every cloze
 * after the first came back as c1.
 */
const CLOZE_HEAD_SOURCE = String.raw`\{\{c(\d+)::`
const CLOZE_HEAD = new RegExp(CLOZE_HEAD_SOURCE)
const CLOZE_HEAD_GLOBAL = new RegExp(CLOZE_HEAD_SOURCE, "g")

export function hasClozeMarker(text: string): boolean {
  return CLOZE_HEAD.test(text)
}

/**
 * The ordinal a new cloze on this side should take: one past the highest already there.
 * Deleting c2 from a side holding c1 and c3 still yields c4, matching the desktop - the
 * ordinal is a fresh name, not a slot to be reused.
 */
export function nextClozeOrdinal(text: string): number {
  let max = 0
  for (const match of text.matchAll(CLOZE_HEAD_GLOBAL)) {
    const value = Number.parseInt(match[1], 10)
    if (Number.isFinite(value) && value > max) max = value
  }
  return max + 1
}

export interface TextEdit {
  text: string
  caret: number
}

/**
 * Wraps the selection in a marker, or inserts an empty pair and parks the caret inside it.
 * There is no toggle-off: pressing bold twice yields `****text****`, as on the desktop.
 */
export function wrapWithMarker(text: string, start: number, end: number, marker: string): TextEdit {
  const selected = end > start ? text.slice(start, end) : ""
  const wrapped = `${marker}${selected}${marker}`
  return {
    text: text.slice(0, start) + wrapped + text.slice(end),
    caret: selected.length > 0 ? start + wrapped.length : start + marker.length,
  }
}

/** Wraps the selection as the next cloze on this side, or inserts an empty marker to type into. */
export function wrapCloze(text: string, start: number, end: number): TextEdit {
  const ordinal = nextClozeOrdinal(text)
  const selected = end > start ? text.slice(start, end) : ""
  const wrapped = `{{c${ordinal}::${selected}}}`
  return {
    text: text.slice(0, start) + wrapped + text.slice(end),
    caret: selected.length > 0 ? start + wrapped.length : start + wrapped.indexOf("::") + 2,
  }
}

/**
 * Whether the card can be saved. A cloze card needs its marker on the front specifically -
 * a marker that only appears on the back does not qualify - but still needs a back, the same
 * as a classic card. Attachments never count: an image-only side is not a card.
 */
export function canSaveCard(input: {
  deckId: string | null
  type: CardType
  front: string
  back: string
}): boolean {
  if (!input.deckId) return false
  if (!input.front.trim() || !input.back.trim()) return false
  return input.type !== "cloze" || hasClozeMarker(input.front)
}

/**
 * Adds a tag if it is new. Comparison ignores case but the typed casing is what gets stored,
 * so "Biology" after "biology" is a no-op rather than a second chip.
 */
export function addTag(tags: string[], raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return tags
  if (tags.some((tag) => tag.toLowerCase() === trimmed.toLowerCase())) return tags
  return [...tags, trimmed]
}

/**
 * The "name · 12 KB" line under a thumbnail. Always kilobytes and never zero, matching the
 * desktop - a 300-byte icon reads as 1 KB rather than nothing.
 */
export function attachmentSizeLabel(displayName: string, sizeBytes: number): string {
  const kb = Math.max(1, Math.round(sizeBytes / 1024))
  return `${displayName} · ${kb} KB`
}
