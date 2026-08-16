import { create } from "zustand"

import type { CardDto, TestResultDto } from "@/api/types"

import { fetchTestQueue, fetchTestRetakeQueue, recordActivity, recordAttempt } from "./api"
import { applyTally, EMPTY_TALLY, type TestGrade, type TestTally, tested } from "./test"

/**
 * Drives one test. Everything here is the client's: the queue arrives once and the grading, the
 * tally and the single-step undo never leave the browser until the test is over. Only two things
 * are written back - the attempt when it finishes, and the effort when the screen goes away.
 */
interface TestState {
  status: "idle" | "loading" | "empty" | "active" | "complete" | "gone"
  deckId: string
  deckName: string
  /** Server-stamped at the queue read; sent back with both writes. */
  startedAt: string
  queue: CardDto[]
  index: number
  /** Typed answer per queue position, kept so undo can put back what was written. */
  answers: string[]
  /** Grade per queue position; null once undone, so the card can be graded again. */
  grades: (TestGrade | null)[]
  tally: TestTally
  revealed: boolean
  /** Null until the attempt lands, so the score screen paints before the write returns. */
  result: TestResultDto | null
  /** True when the attempt could not be written; the score still shows, without its comparisons. */
  resultFailed: boolean
  start: (deckId: string) => Promise<void>
  setAnswer: (text: string) => void
  reveal: () => void
  grade: (grade: TestGrade) => void
  undo: () => void
  replaceCurrent: (card: CardDto) => void
  setFlagged: (flagged: boolean) => void
  retakeMissed: (cardIds: string[]) => Promise<void>
  leave: () => Promise<void>
}

/**
 * Bumped by every start and leave. StrictMode mounts effects twice, so two queue reads race on
 * mount; whichever no longer matches drops its answer rather than replacing a queue the reader
 * has already started on - which, with a shuffling preset, would be a different order.
 */
let generation = 0

/** Guards the two one-way writes, which must not fire twice for the same test. */
let attemptRecorded = false
let activityRecorded = false

const IDLE = {
  deckId: "",
  deckName: "",
  startedAt: "",
  queue: [],
  index: 0,
  answers: [],
  grades: [],
  tally: EMPTY_TALLY,
  revealed: false,
  result: null,
  resultFailed: false,
}

export const useTest = create<TestState>((set, get) => ({
  status: "idle",
  ...IDLE,

  start: async (deckId) => {
    const mine = ++generation
    attemptRecorded = false
    activityRecorded = false
    set({ status: "loading", ...IDLE })

    try {
      const queue = await fetchTestQueue(deckId)
      if (mine !== generation) return
      set({
        status: queue.cards.length === 0 ? "empty" : "active",
        deckId,
        deckName: queue.deckName,
        startedAt: queue.startedAt,
        queue: queue.cards,
        index: 0,
        answers: queue.cards.map(() => ""),
        grades: queue.cards.map(() => null),
        tally: EMPTY_TALLY,
        revealed: false,
        result: null,
        resultFailed: false,
      })
    } catch {
      if (mine !== generation) return
      // The desktop bounces back to the deck when a test cannot be started, with no error surface.
      set({ status: "gone" })
    }
  },

  setAnswer: (text) => {
    const { index, answers, status } = get()
    if (status !== "active") return
    const next = [...answers]
    next[index] = text
    set({ answers: next })
  },

  reveal: () => {
    if (get().status !== "active" || get().revealed) return
    set({ revealed: true })
  },

  grade: (grade) => {
    const { status, revealed, index, grades, tally, queue } = get()
    if (status !== "active" || !revealed) return

    const nextGrades = [...grades]
    nextGrades[index] = grade
    const nextTally = applyTally(tally, grade, +1)
    const nextIndex = index + 1

    set({ grades: nextGrades, tally: nextTally, index: nextIndex, revealed: false })

    if (nextIndex >= queue.length) void complete(set, get)
  },

  /**
   * Steps back one card and takes its grade off the tally, leaving the typed answer in place to
   * be revealed and graded again. Unavailable once the attempt has been recorded: the score on
   * screen would then no longer be the score that was stored.
   */
  undo: () => {
    const { status, index, grades, tally } = get()
    if (status !== "active" || index <= 0) return

    const previous = index - 1
    const graded = grades[previous]
    const nextGrades = [...grades]
    nextGrades[previous] = null

    set({
      index: previous,
      grades: nextGrades,
      tally: graded ? applyTally(tally, graded, -1) : tally,
      revealed: false,
    })
  },

  replaceCurrent: (card) => {
    const { queue, index } = get()
    if (index >= queue.length) return
    set({ queue: queue.map((c, i) => (i === index ? card : c)) })
  },

  setFlagged: (flagged) => {
    const { queue, index } = get()
    const current = queue[index]
    if (!current) return
    set({ queue: queue.map((c, i) => (i === index ? { ...c, isFlagged: flagged } : c)) })
  },

  /**
   * Starts a fresh test over just the cards missed on the run that finished. The queue is fetched
   * from the server so it carries its own StartedAt and drops anything suspended or deleted since;
   * the finished test's effort is written first, since chaining a retake from the score screen
   * never unmounts the first test for leave() to record it.
   */
  retakeMissed: async (cardIds) => {
    const { deckId, startedAt, tally } = get()
    if (!deckId || cardIds.length === 0) return

    const finishedCards = tested(tally)
    if (!activityRecorded && finishedCards > 0) {
      activityRecorded = true
      await recordActivity(deckId, { startedAt, cardsTested: finishedCards }).catch(() => undefined)
    }

    const mine = ++generation
    attemptRecorded = false
    activityRecorded = false
    set({ status: "loading", ...IDLE })

    try {
      const queue = await fetchTestRetakeQueue(deckId, cardIds)
      if (mine !== generation) return
      set({
        status: queue.cards.length === 0 ? "empty" : "active",
        deckId,
        deckName: queue.deckName,
        startedAt: queue.startedAt,
        queue: queue.cards,
        index: 0,
        answers: queue.cards.map(() => ""),
        grades: queue.cards.map(() => null),
        tally: EMPTY_TALLY,
        revealed: false,
        result: null,
        resultFailed: false,
      })
    } catch {
      if (mine !== generation) return
      set({ status: "gone" })
    }
  },

  /**
   * Records the study this test represents and resets. Called when the screen goes away, which is
   * the only chance to write it - a browser tab closed mid-test leaves nothing behind, where the
   * desktop still gets to flush on dispose.
   */
  leave: async () => {
    const { deckId, startedAt, tally } = get()
    const cards = tested(tally)
    generation++
    set({ status: "idle", ...IDLE })

    if (activityRecorded || cards <= 0 || !deckId) return
    activityRecorded = true
    await recordActivity(deckId, { startedAt, cardsTested: cards }).catch(() => undefined)
  },
}))

/**
 * Ends the test: the score screen goes up straight away and fills in once the attempt is written,
 * so a slow write shows a score without a trend rather than an empty screen.
 */
async function complete(
  set: (partial: Partial<TestState>) => void,
  get: () => TestState,
): Promise<void> {
  const { deckId, startedAt, tally } = get()
  set({ status: "complete", revealed: false })

  if (attemptRecorded || tested(tally) <= 0) return
  attemptRecorded = true

  const mine = generation
  try {
    const result = await recordAttempt(deckId, {
      startedAt,
      gotIt: tally.gotIt,
      close: tally.close,
      missed: tally.missed,
    })
    if (mine === generation) set({ result })
  } catch {
    // The screen already has the tally it needs for the score itself; only the delta, the best
    // and the trend are lost, and those degrade to a plain "recorded" line.
    if (mine === generation) set({ resultFailed: true })
  }
}
