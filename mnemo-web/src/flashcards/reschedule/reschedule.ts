import type { CardViewDto, DeckSummaryDto, PresetDto, QueuePlace } from "@/api/types"
import type { TranslateFn } from "@/i18n/types"

import { cardStateKind } from "../bits"

/**
 * Moving cards in time.
 *
 * Anki splits this across three menu items (Set Due Date, Forget, Reposition) which are three
 * names for one intention and are each silently useless on the wrong selection: Reposition on
 * a review card does nothing, Set Due Date on a new card does something most people do not
 * expect, and neither says so. One dialog reads the selection first: a mode that cannot act on
 * these cards is not offered, and the mode that is offered says, in a sentence, what it will do
 * to them, including which of them it will not touch. The sentence is the feature; these are
 * the rules it is built from.
 */

export type RescheduleMode = "due" | "reset" | "position"

export const MODES: readonly RescheduleMode[] = ["due", "reset", "position"]

/** The furthest out a due date goes: a hundred years, which is as far as the scheduler itself reaches. */
export const MAX_DAYS = 36500

export interface RescheduleSplit {
  /** Active new cards: the ones a queue placement moves, and the ones a due date graduates. */
  fresh: CardViewDto[]
  /** Active cards with a schedule: review, learning and relearning. */
  scheduled: CardViewDto[]
  /** Parked on purpose; every mode leaves them alone. */
  suspended: CardViewDto[]
  /** Lapses on the scheduled cards, for the start-over sentence. */
  lapses: number
  /** The deck the new cards share, or null when there are none or they span decks. */
  freshDeckId: string | null
  total: number
}

export function splitSelection(views: CardViewDto[]): RescheduleSplit {
  const fresh: CardViewDto[] = []
  const scheduled: CardViewDto[] = []
  const suspended: CardViewDto[] = []
  for (const view of views) {
    const kind = cardStateKind(view.card, view.schedule)
    if (kind === "suspended") suspended.push(view)
    else if (kind === "new") fresh.push(view)
    else scheduled.push(view)
  }
  const deckIds = new Set(fresh.map((view) => view.card.deckId))
  return {
    fresh,
    scheduled,
    suspended,
    lapses: scheduled.reduce((sum, view) => sum + view.schedule.lapses, 0),
    freshDeckId: deckIds.size === 1 ? fresh[0].card.deckId : null,
    total: views.length,
  }
}

/**
 * Only the modes that can do something here.
 *
 * Position acts on one deck's new queue, so a selection with no new cards in it, or with new
 * cards spread over several decks, cannot use it. Offering a disabled tab would be the same
 * non-answer as Anki's greyed menu item, just closer to the work.
 */
export function availableModes(split: RescheduleSplit): RescheduleMode[] {
  return MODES.filter((mode) => mode !== "position" || split.freshDeckId !== null)
}

/**
 * Whether the mode would leave every card in the selection as it is, in which case there is
 * nothing to apply: a due date on suspended cards only, a start over on new cards only.
 */
export function touchesNothing(split: RescheduleSplit, mode: RescheduleMode): boolean {
  if (mode === "due") return split.scheduled.length + split.fresh.length === 0
  if (mode === "reset") return split.scheduled.length === 0
  return split.fresh.length === 0
}

/**
 * The hour the selection's decks start their study day, when they all agree on one, from the
 * deck list and the preset list the pages already keep. Null while either list is missing a
 * deck or a preset, or when the decks disagree, and the sentence then counts days instead.
 */
export function dayStartHourOf(
  views: CardViewDto[],
  decks: readonly Pick<DeckSummaryDto, "id" | "presetId">[] | undefined,
  presets: readonly Pick<PresetDto, "id" | "nextDayStartsAtHour">[] | undefined,
): number | null {
  if (!decks || !presets || views.length === 0) return null
  const hours = new Set<number>()
  for (const deckId of new Set(views.map((view) => view.card.deckId))) {
    const deck = decks.find((candidate) => candidate.id === deckId)
    const preset = deck ? presets.find((candidate) => candidate.id === deck.presetId) : undefined
    if (!preset) return null
    hours.add(preset.nextDayStartsAtHour)
  }
  return hours.size === 1 ? [...hours][0] : null
}

/**
 * All-new selections are almost always a repositioning; everything else is almost always a
 * due date. Opening on the likely answer saves a click and costs nothing, because the
 * alternatives are right there.
 */
export function initialMode(split: RescheduleSplit): RescheduleMode {
  return split.total > 0 && split.fresh.length === split.total && split.freshDeckId !== null ? "position" : "due"
}

export interface RescheduleOptions {
  mode: RescheduleMode
  /** Study days from today; zero is today. */
  days: number
  matchInterval: boolean
  keepCounts: boolean
  place: QueuePlace
  /** One-based, read only when `place` is "at". */
  at: number
}

export const DEFAULT_OPTIONS: Omit<RescheduleOptions, "mode"> = {
  days: 1,
  matchInterval: false,
  keepCounts: true,
  place: "start",
  at: 1,
}

/**
 * The whole phrase, not the bare date: "today", "tomorrow", "on 21 March". Returning the date
 * alone would leave the sentence to decide whether "on" goes in front by reading its own output
 * back as data.
 *
 * The server counts study days from the deck's day start hour, so between midnight and that
 * hour the study day is still yesterday's date and the card lands a calendar day earlier than
 * a plain count would say. With the hour known the date is worked out the way the server does
 * it; without it (a selection across decks whose days start at different hours, or presets not
 * loaded yet) the phrase counts days rather than naming a date it cannot be sure of.
 */
export function whenPhrase(days: number, fc: Fc, locale: string, now: Date, dayStartHour: number | null): string {
  if (days === 0) return fc("RescheduleWhenToday")
  if (dayStartHour === null) return days === 1 ? fc("RescheduleWhenInOneDay") : fc("RescheduleWhenInDaysFormat", { 0: days })

  const date = new Date(now)
  date.setHours(date.getHours() - dayStartHour)
  // Before the day starts the study day is still yesterday. A count of days from it then lands
  // on a calendar day sooner than the count reads, so the date is named: "tomorrow" for a pick
  // of two days would read as a mistake, and a pick of one day lands later this same morning,
  // which is the only count that lands on today.
  const skewed = date.getDate() !== now.getDate()
  date.setDate(date.getDate() + days)
  if (days === 1) return fc(skewed ? "RescheduleWhenToday" : "RescheduleWhenTomorrow")
  const withYear = date.getFullYear() !== now.getFullYear()
  return fc("RescheduleWhenOnFormat", {
    0: date.toLocaleDateString(locale, { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) }),
  })
}

type Fc = (key: string, params?: Record<string, string | number>) => string

/** `t` bound to the Flashcards namespace, which is where every key here lives. */
export function flashcardsT(t: TranslateFn): Fc {
  return (key, params) => t("Flashcards", key, params)
}

/**
 * What this will do, in one sentence, to this selection.
 *
 * Written per mode rather than assembled from fragments: the interesting part is always the
 * exception (the new cards that will be pulled forward, the suspended ones that will stay
 * suspended) and an exception reads as a clause, not as a template slot.
 *
 * `queueAhead` is how many other new cards sit in the deck's queue, or null while that is not
 * known yet; the placement sentence then says where the cards go without counting the others.
 * `dayStartHour` is the hour the selection's decks start their study day, or null when they do
 * not agree or it is not known yet; the date is then counted rather than named.
 */
export function consequence(
  t: TranslateFn,
  split: RescheduleSplit,
  options: RescheduleOptions,
  queueAhead: number | null,
  locale: string,
  now: Date,
  dayStartHour: number | null,
): string {
  const fc = flashcardsT(t)
  const { fresh, scheduled, suspended, lapses } = split
  const suspendedClause = plural(fc, suspended.length, "RescheduleSuspendedOne", "RescheduleSuspendedManyFormat")

  if (options.mode === "due") {
    const when = whenPhrase(options.days, fc, locale, now, dayStartHour)
    const parts = [
      scheduled.length === 0
        ? null
        : scheduled.length === 1
          ? fc("RescheduleDueScheduledOneFormat", { 0: when })
          : fc("RescheduleDueScheduledManyFormat", { 0: scheduled.length, 1: when }),
      // The surprising one. A new card given a due date is no longer new, and people reach for
      // this dialog without meaning to graduate it.
      plural(fc, fresh.length, "RescheduleDueFreshOne", "RescheduleDueFreshManyFormat"),
      suspendedClause,
      options.matchInterval
        ? fc("RescheduleDueMatched")
        : scheduled.length > 0
          ? fc("RescheduleDueUnmatched")
          : null,
    ]
    return sentence(parts)
  }

  if (options.mode === "reset") {
    if (scheduled.length === 0) {
      return fc(suspended.length > 0 ? "RescheduleResetNothingSuspended" : "RescheduleResetNothing")
    }
    const counts = options.keepCounts
      ? lapses > 0
        ? plural(fc, lapses, "RescheduleResetLapsesOne", "RescheduleResetLapsesManyFormat")
        : fc("RescheduleResetCountsKept")
      : fc("RescheduleResetCountsCleared")
    return sentence([
      plural(fc, scheduled.length, "RescheduleResetOne", "RescheduleResetManyFormat"),
      counts,
      plural(fc, fresh.length, "RescheduleResetIgnoredOne", "RescheduleResetIgnoredManyFormat"),
      suspendedClause,
    ])
  }

  const others = queueAhead === null || queueAhead <= 0 ? null : plural(fc, queueAhead, "RescheduleOthersOne", "RescheduleOthersManyFormat")
  const moved =
    options.place === "at"
      ? fresh.length === 1
        ? fc("ReschedulePositionAtOneFormat", { 0: options.at })
        : fc("ReschedulePositionAtManyFormat", { 0: fresh.length, 1: options.at })
      : placement(fc, fresh.length, options.place, others)
  return sentence([
    moved,
    plural(fc, scheduled.length, "ReschedulePositionIgnoredOne", "ReschedulePositionIgnoredManyFormat"),
    suspendedClause,
  ])
}

/** Literal keys rather than built ones, so a search for a key finds where it is used. */
const PLACEMENT_KEYS = {
  start: {
    one: "ReschedulePositionFrontOne",
    many: "ReschedulePositionFrontManyFormat",
    othersOne: "ReschedulePositionFrontAheadOneFormat",
    othersMany: "ReschedulePositionFrontAheadManyFormat",
  },
  end: {
    one: "ReschedulePositionBackOne",
    many: "ReschedulePositionBackManyFormat",
    othersOne: "ReschedulePositionBackBehindOneFormat",
    othersMany: "ReschedulePositionBackBehindManyFormat",
  },
} as const

function placement(fc: Fc, count: number, place: "start" | "end", others: string | null): string | null {
  const keys = PLACEMENT_KEYS[place]
  if (others === null) return plural(fc, count, keys.one, keys.many)
  return count === 1 ? fc(keys.othersOne, { 0: others }) : fc(keys.othersMany, { 0: count, 1: others })
}

function plural(fc: Fc, count: number, one: string, many: string): string | null {
  if (count === 0) return null
  return count === 1 ? fc(one) : fc(many, { 0: count })
}

function sentence(parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(" ")
}

/** The label on the confirm button: the mode's verb, not a generic "Apply". */
export function applyLabelKey(mode: RescheduleMode): string {
  return mode === "due" ? "RescheduleApplyDue" : mode === "reset" ? "RescheduleApplyReset" : "RescheduleApplyPosition"
}

export type RescheduleRequest =
  | { mode: "due"; cardIds: string[]; days: number; matchInterval: boolean }
  | { mode: "reset"; cardIds: string[]; keepCounts: boolean }
  | { mode: "position"; cardIds: string[]; place: QueuePlace; position: number | null }

/**
 * What goes over the wire. Every selected id is sent, suspended and scheduled ones included:
 * the server applies the same skip rules the sentence describes, so the two cannot disagree
 * about which cards were left alone.
 */
export function rescheduleRequest(cardIds: string[], options: RescheduleOptions): RescheduleRequest {
  switch (options.mode) {
    case "due":
      return { mode: "due", cardIds, days: clampDays(options.days), matchInterval: options.matchInterval }
    case "reset":
      return { mode: "reset", cardIds, keepCounts: options.keepCounts }
    case "position":
      return {
        mode: "position",
        cardIds,
        place: options.place,
        position: options.place === "at" ? Math.max(1, Math.round(options.at)) : null,
      }
  }
}

export function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 0
  return Math.min(MAX_DAYS, Math.max(0, Math.round(days)))
}
