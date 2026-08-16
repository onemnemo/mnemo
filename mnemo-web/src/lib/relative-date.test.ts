import { describe, expect, it } from "vitest"

import type { TranslateFn } from "@/i18n/types"

import { formatRelative, formatSmart } from "./relative-date"

const NOW = new Date("2026-08-08T12:00:00Z").getTime()
const DAY = 24 * 60 * 60 * 1000

// Echoes the key and its argument, so a test can assert which wording branch ran without also
// asserting the English copy.
const t: TranslateFn = (ns, key, params) =>
  params === undefined ? `${ns}/${key}` : `${ns}/${key}(${Object.values(params).join(",")})`

describe("formatRelative", () => {
  it("takes the singular key at a count of one", () => {
    expect(formatRelative(new Date(NOW - DAY), NOW, t)).toBe("Common/DayAgo(1)")
    expect(formatRelative(new Date(NOW - 8 * DAY), NOW, t)).toBe("Common/WeekAgo(1)")
    expect(formatRelative(new Date(NOW - 40 * DAY), NOW, t)).toBe("Common/MonthAgo(1)")
    expect(formatRelative(new Date(NOW - 400 * DAY), NOW, t)).toBe("Common/YearAgo(1)")
  })

  it("takes the plural key at any other count", () => {
    expect(formatRelative(new Date(NOW - 2 * DAY), NOW, t)).toBe("Common/DaysAgo(2)")
    expect(formatRelative(new Date(NOW - 21 * DAY), NOW, t)).toBe("Common/WeeksAgo(3)")
    expect(formatRelative(new Date(NOW - 800 * DAY), NOW, t)).toBe("Common/YearsAgo(2)")
  })
})

describe("formatSmart", () => {
  it("words anything under a week relatively", () => {
    expect(formatSmart(new Date(NOW - 30_000), NOW, t, "en-US")).toBe("Common/JustNow")
    expect(formatSmart(new Date(NOW - 3 * DAY), NOW, t, "en-US")).toBe("Common/DaysAgo(3)")
    expect(formatSmart(new Date(NOW - 6.9 * DAY), NOW, t, "en-US")).toBe("Common/DaysAgo(6)")
  })

  it("switches to a short date at exactly seven days", () => {
    // This is the whole reason the function exists. formatRelative keeps counting into weeks and
    // months, so a 30-day window would render "3 weeks ago" against the desktop's 12/07/2026.
    const older = formatSmart(new Date(NOW - 7 * DAY), NOW, t, "en-US")
    expect(older).not.toContain("Common/")
    expect(older).toBe(new Date(NOW - 7 * DAY).toLocaleDateString("en-US"))
  })

  it("writes the absolute date the way the locale writes it", () => {
    const value = new Date(NOW - 90 * DAY)
    expect(formatSmart(value, NOW, t, "de-DE")).toBe(value.toLocaleDateString("de-DE"))
    expect(formatSmart(value, NOW, t, "ja-JP")).toBe(value.toLocaleDateString("ja-JP"))
  })

  it("accepts an ISO string as well as a Date", () => {
    const value = new Date(NOW - 2 * DAY)
    expect(formatSmart(value.toISOString(), NOW, t, "en-US")).toBe("Common/DaysAgo(2)")
  })

  it("renders an unparseable timestamp as nothing rather than as Invalid Date", () => {
    expect(formatSmart("not a date", NOW, t, "en-US")).toBe("")
  })
})
