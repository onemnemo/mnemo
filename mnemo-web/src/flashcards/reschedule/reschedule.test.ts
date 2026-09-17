/**
 * The rules the reschedule dialog is built from: which modes a selection can take, what the
 * sentence under the controls says, and what goes over the wire. The sentences are rendered
 * through the real English bundle, so a key the sentence reads and nobody added shows up here
 * as a bare key rather than on screen.
 */
import { describe, expect, it } from "vitest"

import type { CardViewDto, FsrsState } from "@/api/types"
import { mergedEnglishBundle, readRepoText, resolves } from "@/i18n/test-bundle"
import { createTranslate } from "@/i18n/translate"

import {
  availableModes,
  clampDays,
  consequence,
  dayStartHourOf,
  DEFAULT_OPTIONS,
  initialMode,
  rescheduleRequest,
  splitSelection,
  touchesNothing,
  whenPhrase,
  type RescheduleOptions,
} from "./reschedule"

const t = createTranslate(mergedEnglishBundle())
const NOW = new Date(2026, 2, 5, 9, 30)

function view(id: string, fsrsState: FsrsState, extra: { suspended?: boolean; lapses?: number; deckId?: string } = {}): CardViewDto {
  return {
    card: {
      id,
      deckId: extra.deckId ?? "d1",
      type: "classic",
      front: id,
      back: "",
      tags: [],
      state: extra.suspended ? "suspended" : "active",
      isFlagged: false,
      attachments: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    schedule: {
      dueDate: "2026-03-10T04:00:00Z",
      stability: fsrsState === "new" ? null : 12,
      difficulty: fsrsState === "new" ? null : 5,
      reps: fsrsState === "new" ? 0 : 4,
      lapses: extra.lapses ?? 0,
      fsrsState,
      learningStepIndex: 0,
      lastReviewedAt: fsrsState === "new" ? null : "2026-02-20T10:00:00Z",
    },
  }
}

const MIXED = [
  view("n1", "new"),
  view("n2", "new"),
  view("l1", "learning"),
  view("r1", "review", { lapses: 2 }),
  view("s1", "review", { suspended: true, lapses: 5 }),
]

function options(mode: RescheduleOptions["mode"], patch: Partial<RescheduleOptions> = {}): RescheduleOptions {
  return { ...DEFAULT_OPTIONS, mode, ...patch }
}

const sentence = (views: CardViewDto[], opts: RescheduleOptions, queueAhead: number | null = 197) =>
  consequence(t, splitSelection(views), opts, queueAhead, "en-GB", NOW, 4)

describe("splitSelection", () => {
  it("sorts the selection by what each mode can do to it", () => {
    const split = splitSelection(MIXED)
    expect(split.fresh.map((v) => v.card.id)).toEqual(["n1", "n2"])
    expect(split.scheduled.map((v) => v.card.id)).toEqual(["l1", "r1"])
    expect(split.suspended.map((v) => v.card.id)).toEqual(["s1"])
    expect(split.total).toBe(5)
  })

  it("counts lapses on the cards a start-over touches, not on the suspended ones", () => {
    expect(splitSelection(MIXED).lapses).toBe(2)
  })

  it("names the deck the new cards share and nothing when they span decks", () => {
    expect(splitSelection([view("a", "new"), view("b", "new")]).freshDeckId).toBe("d1")
    expect(splitSelection([view("a", "new"), view("b", "new", { deckId: "d2" })]).freshDeckId).toBeNull()
    expect(splitSelection([view("r", "review")]).freshDeckId).toBeNull()
  })

  it("treats a suspended new card as suspended, not new", () => {
    const split = splitSelection([view("x", "new", { suspended: true })])
    expect(split.fresh).toEqual([])
    expect(split.suspended).toHaveLength(1)
  })
})

describe("availableModes and initialMode", () => {
  it("offers position only when there are new cards, in one deck", () => {
    expect(availableModes(splitSelection(MIXED))).toEqual(["due", "reset", "position"])
    expect(availableModes(splitSelection([view("r", "review")]))).toEqual(["due", "reset"])
    expect(availableModes(splitSelection([view("a", "new"), view("b", "new", { deckId: "d2" })]))).toEqual(["due", "reset"])
  })

  it("opens on position for an all-new selection and on due for anything else", () => {
    expect(initialMode(splitSelection([view("a", "new"), view("b", "new")]))).toBe("position")
    expect(initialMode(splitSelection(MIXED))).toBe("due")
    expect(initialMode(splitSelection([view("r", "review")]))).toBe("due")
    expect(initialMode(splitSelection([]))).toBe("due")
  })
})

describe("whenPhrase", () => {
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  it("says today and tomorrow in words and any other day with a date", () => {
    expect(whenPhrase(0, fc, "en-GB", NOW, 4)).toBe("today")
    expect(whenPhrase(1, fc, "en-GB", NOW, 4)).toBe("tomorrow")
    expect(whenPhrase(16, fc, "en-GB", NOW, 4)).toBe("on 21 March")
  })

  it("counts from the study day the server is on, which before the day starts is still yesterday", () => {
    // Two in the morning on the fifth with a four o'clock start: the study day is the fourth, so
    // two days on is the sixth, and one day on is later this same morning.
    const smallHours = new Date(2026, 2, 5, 2, 0)
    expect(whenPhrase(2, fc, "en-GB", smallHours, 4)).toBe("on 6 March")
    expect(whenPhrase(1, fc, "en-GB", smallHours, 4)).toBe("today")
    expect(whenPhrase(3, fc, "en-GB", smallHours, 4)).toBe("on 7 March")
    // A count that lands on the same day and month next year is not today.
    expect(whenPhrase(366, fc, "en-GB", smallHours, 4)).toBe("on 5 March 2027")
  })

  it("counts days rather than naming a date when the day start hour is not known", () => {
    // One day is the count the small hours get wrong, so it is not "tomorrow" either.
    expect(whenPhrase(1, fc, "en-GB", NOW, null)).toBe("in 1 day")
    expect(whenPhrase(16, fc, "en-GB", NOW, null)).toBe("in 16 days")
  })

  it("names the year once the date is in another one", () => {
    expect(whenPhrase(400, fc, "en-GB", NOW, 4)).toBe("on 9 April 2027")
  })
})

describe("consequence: due date", () => {
  it("names each group of a mixed selection and what happens to it", () => {
    expect(sentence(MIXED, options("due", { days: 1 }))).toBe(
      "2 cards become due tomorrow. " +
        "2 new cards leave the new queue and start as review. " +
        "1 suspended card stays suspended. " +
        "Intervals are left alone, so the date moves and the spacing does not.",
    )
  })

  it("uses the singular forms", () => {
    expect(sentence([view("r", "review"), view("n", "new")], options("due", { days: 0 }))).toBe(
      "1 card becomes due today. " +
        "1 new card leaves the new queue and starts as review. " +
        "Intervals are left alone, so the date moves and the spacing does not.",
    )
  })

  it("says the interval is rewritten when the switch is on", () => {
    expect(sentence([view("r", "review")], options("due", { days: 3, matchInterval: true }))).toBe(
      "1 card becomes due on 8 March. The interval is rewritten to match the new date.",
    )
  })

  it("does not talk about intervals when nothing scheduled is selected", () => {
    expect(sentence([view("n", "new")], options("due"))).toBe("1 new card leaves the new queue and starts as review.")
  })
})

describe("consequence: start over", () => {
  it("says the cards return to new and that the lapses are kept, and names the new cards it skips", () => {
    expect(sentence(MIXED, options("reset"))).toBe(
      "2 cards return to the new queue and are learned from the start. " +
        "The 2 lapses already recorded are kept. " +
        "The other 2 cards are already new and are left alone. " +
        "1 suspended card stays suspended.",
    )
  })

  it("says the counts are kept when there are no lapses to name", () => {
    expect(sentence([view("r", "review")], options("reset"))).toBe(
      "1 card returns to the new queue and is learned from the start. Review counts are kept.",
    )
  })

  it("says the counts start from zero when the switch is off", () => {
    expect(sentence([view("r", "review", { lapses: 3 })], options("reset", { keepCounts: false }))).toBe(
      "1 card returns to the new queue and is learned from the start. Their review and lapse counts start from zero.",
    )
  })

  it("says nothing changes for an all-new selection, and why when suspended cards are in it", () => {
    expect(sentence([view("n", "new")], options("reset"))).toBe("These cards are already new. Nothing changes.")
    expect(sentence([view("n", "new"), view("s", "review", { suspended: true })], options("reset"))).toBe(
      "Nothing changes: suspended cards are left alone, and the rest are already new.",
    )
  })
})

describe("consequence: queue position", () => {
  it("counts the others ahead or behind and names what is left alone", () => {
    expect(sentence(MIXED, options("position", { place: "start" }))).toBe(
      "2 new cards move to the front of the new queue, ahead of 197 others. " +
        "The other 2 cards already have a schedule and are left alone. " +
        "1 suspended card stays suspended.",
    )
    expect(sentence([view("n", "new")], options("position", { place: "end" }), 1)).toBe(
      "1 new card moves to the back of the new queue, behind 1 other.",
    )
  })

  it("names the position for an exact placement", () => {
    expect(sentence([view("n", "new")], options("position", { place: "at", at: 4 }))).toBe("1 new card moves to position 4.")
    expect(sentence([view("a", "new"), view("b", "new")], options("position", { place: "at", at: 2 }))).toBe(
      "2 new cards move to position 2.",
    )
  })

  it("leaves the count out while it is unknown or when there is nobody else in the queue", () => {
    expect(sentence([view("n", "new")], options("position", { place: "start" }), null)).toBe(
      "1 new card moves to the front of the new queue.",
    )
    expect(sentence([view("a", "new"), view("b", "new")], options("position", { place: "end" }), 0)).toBe(
      "2 new cards move to the back of the new queue.",
    )
  })
})

describe("rescheduleRequest", () => {
  it("sends every selected id and only the options the mode reads", () => {
    const ids = ["a", "b"]
    expect(rescheduleRequest(ids, options("due", { days: 3, matchInterval: true, keepCounts: false }))).toEqual({
      mode: "due",
      cardIds: ids,
      days: 3,
      matchInterval: true,
    })
    expect(rescheduleRequest(ids, options("reset", { keepCounts: false, days: 9 }))).toEqual({
      mode: "reset",
      cardIds: ids,
      keepCounts: false,
    })
    expect(rescheduleRequest(ids, options("position", { place: "start", at: 7 }))).toEqual({
      mode: "position",
      cardIds: ids,
      place: "start",
      position: null,
    })
    expect(rescheduleRequest(ids, options("position", { place: "at", at: 7.4 }))).toEqual({
      mode: "position",
      cardIds: ids,
      place: "at",
      position: 7,
    })
  })

  it("keeps the days inside what the scheduler can take", () => {
    expect(clampDays(-2)).toBe(0)
    expect(clampDays(2.6)).toBe(3)
    expect(clampDays(1e9)).toBe(36500)
    expect(clampDays(Number.NaN)).toBe(0)
  })
})

describe("touchesNothing", () => {
  it("is true only when the mode would leave every card as it is", () => {
    const suspendedOnly = splitSelection([view("s", "review", { suspended: true })])
    expect(touchesNothing(suspendedOnly, "due")).toBe(true)
    expect(touchesNothing(suspendedOnly, "reset")).toBe(true)
    expect(touchesNothing(splitSelection([view("n", "new")]), "reset")).toBe(true)
    expect(touchesNothing(splitSelection([view("n", "new")]), "due")).toBe(false)
    expect(touchesNothing(splitSelection(MIXED), "reset")).toBe(false)
  })
})

describe("dayStartHourOf", () => {
  const decks = [
    { id: "deck-1", presetId: "p-early" },
    { id: "deck-2", presetId: "p-late" },
    { id: "deck-3", presetId: "p-early" },
  ]
  const presets = [
    { id: "p-early", nextDayStartsAtHour: 4 },
    { id: "p-late", nextDayStartsAtHour: 6 },
  ]

  it("is the one hour the selection's decks agree on, and null when they do not or a list is missing", () => {
    const one = view("a", "new", { deckId: "deck-1" })
    expect(dayStartHourOf([one], decks, presets)).toBe(4)
    expect(dayStartHourOf([one, view("b", "new", { deckId: "deck-3" })], decks, presets)).toBe(4)
    expect(dayStartHourOf([one, view("b", "new", { deckId: "deck-2" })], decks, presets)).toBeNull()
    expect(dayStartHourOf([one], undefined, presets)).toBeNull()
    expect(dayStartHourOf([one], decks, undefined)).toBeNull()
    expect(dayStartHourOf([view("a", "new", { deckId: "deck-9" })], decks, presets)).toBeNull()
  })
})

describe("translations", () => {
  const bundle = mergedEnglishBundle()
  const source =
    readRepoText("mnemo-web", "src", "flashcards", "reschedule", "reschedule.ts") +
    readRepoText("mnemo-web", "src", "flashcards", "reschedule", "RescheduleDialog.tsx") +
    readRepoText("mnemo-web", "src", "flashcards", "deck", "components", "SelectionBar.tsx")
  const keys = [...new Set([...source.matchAll(/"(Reschedule[A-Za-z0-9]+|BatchReschedule|RowReschedule)"/g)].map((m) => m[1]!))]

  it("found the keys to check", () => {
    expect(keys).toContain("RescheduleTitle")
    expect(keys).toContain("ReschedulePositionBackBehindManyFormat")
    expect(keys.length).toBeGreaterThan(50)
  })

  it.each(keys)("resolves Flashcards/%s", (key) => {
    expect(resolves(bundle, "Flashcards", key), `Flashcards/${key} is missing from the bundle`).toBe(true)
  })
})
