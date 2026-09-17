// @vitest-environment jsdom

/**
 * The dialog as a function of its selection: the modes it offers, the sentence it shows, and
 * the request it sends when confirmed. Mounted under StrictMode, so an effect that misbehaves
 * on the double invoke shows up here rather than in the dev app.
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardViewDto, FsrsState } from "@/api/types"

import { RescheduleDialog } from "./RescheduleDialog"

const api = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => undefined),
  queue: { data: { count: 12 } as { count: number } | undefined },
}))

vi.mock("./api", () => ({
  useRescheduleCards: () => ({ mutateAsync: api.mutateAsync, isPending: false }),
  useNewQueueQuery: () => api.queue,
}))

// The deck and preset lists, for the hour the study day starts: the fixture deck on the
// standard four, so the sentence names days the way the server lands on them.
vi.mock("../api", () => ({
  useDecksQuery: () => ({ data: [{ id: "d1", presetId: "preset-1" }] }),
}))

vi.mock("../presets/api", () => ({
  usePresetsQuery: () => ({ data: [{ id: "preset-1", nextDayStartsAtHour: 4 }] }),
}))

// Keys rather than English: the sentences themselves are pinned against the real bundle in
// reschedule.test.ts, and what matters here is which keys the dialog composes and when.
vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string, params?: Record<string, string | number>) =>
    params ? `${key}(${Object.values(params).join(",")})` : key,
}))

vi.mock("@/i18n/store", () => ({
  useI18nStore: (selector: (state: { language: string }) => unknown) => selector({ language: "en-GB" }),
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

function view(id: string, fsrsState: FsrsState, suspended = false): CardViewDto {
  return {
    card: {
      id,
      deckId: "d1",
      type: "classic",
      front: id,
      back: "",
      tags: [],
      state: suspended ? "suspended" : "active",
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
      lapses: 0,
      fsrsState,
      learningStepIndex: 0,
      lastReviewedAt: null,
    },
  }
}

const MIXED = [view("n1", "new"), view("r1", "review"), view("s1", "review", true)]

let container: HTMLElement
let root: Root
const onClose = vi.fn()
const onApplied = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // Midday, well past the four o'clock start, so one day on is plainly tomorrow.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 2, 5, 12, 0))
  api.queue.data = { count: 12 }
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function mount(views: CardViewDto[]): void {
  act(() =>
    root.render(
      <StrictMode>
        <RescheduleDialog views={views} onClose={onClose} onApplied={onApplied} />
      </StrictMode>,
    ),
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function radio(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('[role="radio"]')].find((element) => element.textContent?.trim() === label)
  expect(match, `no mode named ${label}`).toBeDefined()
  return match as HTMLButtonElement
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
  expect(match, `no button named ${label}`).toBeDefined()
  return match as HTMLButtonElement
}

function sentence(): string {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? ""
}

describe("RescheduleDialog", () => {
  it("offers the three modes to a mixed selection and opens on the due date", () => {
    mount(MIXED)

    expect([...document.querySelectorAll('[role="radio"]')].map((el) => el.textContent?.trim())).toEqual([
      "RescheduleModeDue",
      "RescheduleModeReset",
      "RescheduleModePosition",
    ])
    expect(radio("RescheduleModeDue").getAttribute("aria-checked")).toBe("true")
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("RescheduleTitle")
    expect(sentence()).toBe(
      "RescheduleDueScheduledOneFormat(RescheduleWhenTomorrow) RescheduleDueFreshOne RescheduleSuspendedOne RescheduleDueUnmatched",
    )
  })

  it("does not offer a queue position when nothing new is selected", () => {
    mount([view("r1", "review")])

    expect([...document.querySelectorAll('[role="radio"]')].map((el) => el.textContent?.trim())).toEqual([
      "RescheduleModeDue",
      "RescheduleModeReset",
    ])
  })

  it("rewrites the sentence and the confirm label as the controls change", () => {
    mount(MIXED)

    act(() => button("RescheduleToday").click())
    expect(sentence()).toContain("RescheduleDueScheduledOneFormat(RescheduleWhenToday)")

    act(() => radio("RescheduleModeReset").click())
    expect(sentence()).toBe("RescheduleResetOne RescheduleResetCountsKept RescheduleResetIgnoredOne RescheduleSuspendedOne")
    expect(button("RescheduleApplyReset")).toBeDefined()

    act(() => radio("RescheduleModePosition").click())
    // Twelve in the queue, one of them the selected card: eleven others.
    expect(sentence()).toBe(
      "ReschedulePositionFrontAheadOneFormat(RescheduleOthersManyFormat(11)) ReschedulePositionIgnoredOne RescheduleSuspendedOne",
    )
    expect(button("RescheduleApplyPosition")).toBeDefined()
  })

  it("cannot apply a change that would touch nothing", () => {
    // Every card suspended: the sentence says so, and there is nothing to confirm.
    mount([view("s1", "review", true), view("s2", "review", true)])

    expect(sentence()).toBe("RescheduleSuspendedManyFormat(2)")
    expect(button("RescheduleApplyDue").disabled).toBe(true)

    act(() => radio("RescheduleModeReset").click())
    expect(button("RescheduleApplyReset").disabled).toBe(true)
  })

  it("sends every selected id with the chosen options and hands back the sentence", async () => {
    mount(MIXED)

    act(() => button("RescheduleToday").click())
    act(() => button("RescheduleApplyDue").click())
    await flush()

    expect(api.mutateAsync).toHaveBeenCalledWith({
      mode: "due",
      cardIds: ["n1", "r1", "s1"],
      days: 0,
      matchInterval: false,
    })
    expect(onApplied).toHaveBeenCalledWith(expect.stringContaining("RescheduleDueScheduledOneFormat(RescheduleWhenToday)"))
    expect(onClose).toHaveBeenCalled()
  })

  it("keeps the dialog open and hands nothing back when the request fails", async () => {
    api.mutateAsync.mockRejectedValueOnce(new Error("offline"))
    mount(MIXED)

    act(() => button("RescheduleApplyDue").click())
    await flush()

    expect(onApplied).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})
