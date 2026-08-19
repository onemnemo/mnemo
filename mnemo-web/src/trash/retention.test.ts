import { describe, expect, it } from "vitest"

import type { TranslateFn } from "@/i18n/types"

import { formatExpiresIn, retentionDays } from "./retention"
import type { TrashEntryDto } from "./types"

const NOW = new Date("2026-08-20T12:00:00Z").getTime()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Echoes the key and its argument, so a test can assert which wording branch ran without also
// asserting the English copy.
const t: TranslateFn = (ns, key, params) =>
  params === undefined ? `${ns}/${key}` : `${ns}/${key}(${Object.values(params).join(",")})`

function at(offset: number): string {
  return new Date(NOW + offset).toISOString()
}

function entry(deletedAt: string, expiresAt: string): TrashEntryDto {
  return {
    id: "e",
    kind: "note",
    itemId: "i",
    title: "Something",
    origin: null,
    containedCount: 0,
    batchId: "b",
    deletedAt,
    expiresAt,
    sourceAvailable: true,
  }
}

describe("formatExpiresIn", () => {
  it("stops counting under an hour, and stays there past the deadline", () => {
    // The sweep runs on its own schedule, so a row can outlive its own date by minutes. Counting
    // that as a negative number of hours would be the only place in the app showing one.
    expect(formatExpiresIn(at(30 * MINUTE), NOW, t)).toBe("Trash/ExpiresSoon")
    expect(formatExpiresIn(at(-2 * HOUR), NOW, t)).toBe("Trash/ExpiresSoon")
  })

  it("floors the hours, so it never claims more of the last day than is left", () => {
    expect(formatExpiresIn(at(HOUR), NOW, t)).toBe("Trash/ExpiresHour(1)")
    expect(formatExpiresIn(at(HOUR + 59 * MINUTE), NOW, t)).toBe("Trash/ExpiresHour(1)")
    expect(formatExpiresIn(at(5 * HOUR + 55 * MINUTE), NOW, t)).toBe("Trash/ExpiresHours(5)")
    expect(formatExpiresIn(at(DAY - MINUTE), NOW, t)).toBe("Trash/ExpiresHours(23)")
  })

  it("rounds the days up, so a row deleted a moment ago reads as its full retention", () => {
    // The whole reason this is not a floor: the server writes the deadline from the instant of the
    // delete, so a thirty day retention is already a few milliseconds short of thirty days by the
    // time anyone reads it, and "29 days left" under a toast promising thirty reads as a bug.
    expect(formatExpiresIn(at(30 * DAY - 2000), NOW, t)).toBe("Trash/ExpiresDays(30)")
    expect(formatExpiresIn(at(DAY), NOW, t)).toBe("Trash/ExpiresDay(1)")
    expect(formatExpiresIn(at(DAY + MINUTE), NOW, t)).toBe("Trash/ExpiresDays(2)")
  })

  it("says nothing at all when the date cannot be read", () => {
    expect(formatExpiresIn("not a date", NOW, t)).toBe("")
  })
})

describe("retentionDays", () => {
  it("rounds the promised span, which the server writes a hair short of whole days", () => {
    expect(retentionDays(entry(at(0), at(30 * DAY - 2000)))).toBe(30)
    expect(retentionDays(entry(at(0), at(7 * DAY)))).toBe(7)
  })

  it("never promises zero days", () => {
    expect(retentionDays(entry(at(0), at(HOUR)))).toBe(1)
  })

  it("falls back to nothing readable rather than NaN", () => {
    expect(retentionDays(entry("not a date", at(30 * DAY)))).toBe(0)
  })
})
