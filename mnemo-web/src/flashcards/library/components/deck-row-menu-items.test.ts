import { describe, expect, it, vi } from "vitest"

import type { DeckSummaryDto } from "@/api/types"
import type { TranslateFn } from "@/i18n/types"

import { deckMenuItems, type DeckMenuEntry, type DeckMenuHandlers, type DeckMenuItem } from "./deck-row-menu-items"

const deck = (over: Partial<DeckSummaryDto> = {}) =>
  ({
    id: "d1",
    name: "Pharmacology",
    activeCards: 340,
    dueCounts: { new: 4, learning: 3, due: 5, total: 12 },
    ...over,
  }) as unknown as DeckSummaryDto

const t: TranslateFn = (_ns, key) => key

const handlers = (): DeckMenuHandlers => ({
  open: vi.fn(),
  review: vi.fn(),
  cramDue: vi.fn(),
  cramAll: vi.fn(),
  test: vi.fn(),
  rename: vi.fn(),
  reviewSettings: vi.fn(),
  export: vi.fn(),
  remove: vi.fn(),
})

function flatten(entries: readonly DeckMenuEntry[]): DeckMenuEntry[] {
  return entries.flatMap((entry) => (entry.kind === "submenu" ? [entry, ...flatten(entry.items)] : [entry]))
}

function itemById(entries: readonly DeckMenuEntry[], id: string): DeckMenuItem {
  const found = flatten(entries).find((entry) => entry.id === id)
  if (!found || found.kind !== "item") throw new Error(`no item ${id}`)
  return found
}

describe("deckMenuItems", () => {
  it("gives every entry an id unique across the whole tree", () => {
    const ids = flatten(deckMenuItems({ deck: deck(), upToDate: false, t, on: handlers() })).map((entry) => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it("suggests review while cards are waiting", () => {
    const entries = deckMenuItems({ deck: deck(), upToDate: false, t, on: handlers() })

    expect(itemById(entries, "study.review").emphasis).toBe(true)
    expect(flatten(entries).find((entry) => entry.id === "study.cram")).toMatchObject({ emphasis: false })
  })

  it("suggests cram once the deck is caught up", () => {
    const entries = deckMenuItems({ deck: deck(), upToDate: true, t, on: handlers() })

    expect(itemById(entries, "study.review").emphasis).toBe(false)
    expect(flatten(entries).find((entry) => entry.id === "study.cram")).toMatchObject({ emphasis: true })
  })

  it("counts due cards and the whole deck separately on the cram rows", () => {
    const entries = deckMenuItems({ deck: deck(), upToDate: false, t, on: handlers() })

    expect(itemById(entries, "study.cram.due").hint).toBe("12")
    expect(itemById(entries, "study.cram.all").hint).toBe("340")
  })

  it("wires each row to its own handler", () => {
    const on = handlers()
    const entries = deckMenuItems({ deck: deck(), upToDate: false, t, on })
    const pairs: ReadonlyArray<readonly [string, keyof DeckMenuHandlers]> = [
      ["study.review", "review"],
      ["study.cram.due", "cramDue"],
      ["study.cram.all", "cramAll"],
      ["study.test", "test"],
      ["open", "open"],
      ["rename", "rename"],
      ["review-settings", "reviewSettings"],
      ["export", "export"],
      ["delete", "remove"],
    ]

    for (const [id, handler] of pairs) {
      itemById(entries, id).run?.()
      expect(on[handler], id).toHaveBeenCalledTimes(1)
    }
  })

  it("marks delete as the destructive row and nothing else", () => {
    const entries = deckMenuItems({ deck: deck(), upToDate: false, t, on: handlers() })
    const danger = flatten(entries).filter((entry) => entry.kind === "item" && entry.danger)

    expect(danger.map((entry) => entry.id)).toEqual(["delete"])
  })

  it("wires export to its handler rather than leaving it disabled", () => {
    const entries = deckMenuItems({ deck: deck(), upToDate: false, t, on: handlers() })
    const item = itemById(entries, "export")

    expect(item.disabled).toBeFalsy()
    expect(item.run).toBeTypeOf("function")
  })
})
