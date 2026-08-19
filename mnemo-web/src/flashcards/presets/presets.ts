import type { AutoReveal, LeechAction, PresetDto, SavePresetDto } from "@/api/types"

/** The bounds the dialog offers, mirrored from PresetEndpoints so the two agree. */
export const MIN_RETENTION_PCT = 80
export const MAX_RETENTION_PCT = 97
export const MAX_NEW_PER_DAY = 999
export const MAX_REVIEWS_PER_DAY = 9999
export const MAX_LEARNING_STEPS = 5
export const MAX_LEECH_LAPSES = 999

/** A year, in minutes. Matches the server's cap so an absurd step reads as an error inline. */
export const MAX_STEP_MINUTES = 525_600

/** The seeded preset's id, which the server refuses to delete. */
export const STANDARD_PRESET_ID = "preset-standard"

/**
 * An editable copy of one preset. Every preset gets a draft when the dialog opens and keeps it
 * for as long as the dialog lives, so switching rows in the sidebar and back does not lose an
 * edit - the desktop holds the same per-row drafts and saves each dirty one on Save.
 */
export interface PresetDraft {
  /** Local identity. Equal to the server id once persisted; a temporary key until then. */
  key: string
  /** Null while this preset exists only in the dialog. */
  serverId: string | null
  name: string
  newPerDay: number
  maxReviewsPerDay: number
  /** A fraction, matching the wire; the slider works in whole percent. */
  desiredRetention: number
  learningSteps: number[]
  shuffleOrder: boolean
  buryRelated: boolean
  autoReveal: AutoReveal
  /** The local hour a study day rolls over at, 0 to 23. */
  nextDayStartsAtHour: number
  /** How many lapses a card is allowed before the action below applies to it. */
  leechThreshold: number
  leechAction: LeechAction
  deckCount: number
  isStandard: boolean
  dirty: boolean
}

/** The hours the day-start row offers, which is every one of them. */
export const DAY_START_HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/** The Standard defaults, which seed a new preset and back "Restore defaults". */
const STANDARD_VALUES = {
  newPerDay: 20,
  maxReviewsPerDay: 200,
  desiredRetention: 0.9,
  learningSteps: [1, 10],
  shuffleOrder: false,
  buryRelated: true,
  autoReveal: "off",
  nextDayStartsAtHour: 4,
  leechThreshold: 8,
  leechAction: "tag",
} as const

export function draftFromPreset(preset: PresetDto): PresetDraft {
  return {
    key: preset.id,
    serverId: preset.id,
    name: preset.name,
    newPerDay: preset.newPerDay,
    maxReviewsPerDay: preset.maxReviewsPerDay,
    desiredRetention: preset.desiredRetention,
    learningSteps: preset.learningSteps,
    shuffleOrder: preset.shuffleOrder,
    buryRelated: preset.buryRelated,
    autoReveal: preset.autoReveal,
    nextDayStartsAtHour: preset.nextDayStartsAtHour,
    leechThreshold: preset.leechThreshold,
    leechAction: preset.leechAction,
    deckCount: preset.deckCount,
    isStandard: preset.isStandard,
    dirty: false,
  }
}

/** A brand-new preset, seeded from Standard and dirty from birth so Save picks it up. */
export function newDraft(key: string, name: string): PresetDraft {
  return {
    key,
    serverId: null,
    name,
    ...STANDARD_VALUES,
    learningSteps: [...STANDARD_VALUES.learningSteps],
    deckCount: 0,
    isStandard: false,
    dirty: true,
  }
}

/** Resets scheduling values but not the name - "Restore defaults" is not a rename. */
export function restoreDefaults(draft: PresetDraft): PresetDraft {
  return {
    ...draft,
    ...STANDARD_VALUES,
    learningSteps: [...STANDARD_VALUES.learningSteps],
    dirty: true,
  }
}

export function toSaveDto(draft: PresetDraft): SavePresetDto {
  return {
    name: draft.name,
    newPerDay: draft.newPerDay,
    maxReviewsPerDay: draft.maxReviewsPerDay,
    desiredRetention: draft.desiredRetention,
    learningSteps: draft.learningSteps,
    shuffleOrder: draft.shuffleOrder,
    buryRelated: draft.buryRelated,
    autoReveal: draft.autoReveal,
    nextDayStartsAtHour: draft.nextDayStartsAtHour,
    leechThreshold: draft.leechThreshold,
    leechAction: draft.leechAction,
  }
}

/** "1m 10m" - what the steps box shows for a stored preset. */
export function formatSteps(steps: number[]): string {
  return steps.map((minutes) => `${minutes}m`).join(" ")
}

const STEP_SEPARATOR = /[\s,·]+/
const STEP_TOKEN = /^(\d+)m?$/i

/**
 * Parses "1m 10m", "1, 10" or "1m·10m" into positive minute counts. Returns null when the text
 * is not a usable list, which is the whole error condition - the box turns red and Save locks.
 */
export function parseSteps(text: string): number[] | null {
  const tokens = text.trim().split(STEP_SEPARATOR).filter(Boolean)
  if (tokens.length < 1 || tokens.length > MAX_LEARNING_STEPS) return null

  const steps: number[] = []
  for (const token of tokens) {
    const match = STEP_TOKEN.exec(token)
    if (!match?.[1]) return null
    const minutes = Number(match[1])
    // Capped as well as floored: the scheduler adds a step straight to the due date, so a step
    // of a billion minutes parks the card centuries out without anything reporting an error.
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_STEP_MINUTES) return null
    steps.push(minutes)
  }
  return steps
}

/** "New preset", then "New preset 2", "New preset 3" - the desktop's dedupe, case-insensitively. */
export function uniqueName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base

  let suffix = 2
  while (lower.has(`${base} ${suffix}`.toLowerCase())) suffix++
  return `${base} ${suffix}`
}

/**
 * Whether Save should be offered: something was edited, or the deck was pointed at a different
 * preset, and the steps box currently parses.
 */
export function canSave({
  drafts,
  stepsValid,
  deckId,
  selectedKey,
  originalPresetId,
}: {
  drafts: readonly PresetDraft[]
  stepsValid: boolean
  deckId: string | null
  selectedKey: string | null
  originalPresetId: string | null
}): boolean {
  if (!stepsValid) return false
  if (drafts.some((draft) => draft.dirty)) return true
  return deckId !== null && selectedKey !== null && selectedKey !== originalPresetId
}

/** Percent for the slider; the wire keeps the fraction. */
export function retentionPercent(fraction: number): number {
  return Math.round(fraction * 100)
}

/**
 * Whether a draft field's new value is actually different.
 *
 * Learning steps arrive as a freshly parsed array on every keystroke, so comparing by reference
 * would call every one of them an edit - including retyping the value that was already there.
 */
export function differs(current: unknown, next: unknown): boolean {
  if (Array.isArray(current) && Array.isArray(next)) {
    return current.length !== next.length || current.some((value, i) => value !== next[i])
  }
  return current !== next
}
