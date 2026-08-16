import { describe, expect, it } from "vitest"

import { createTranslate } from "@/i18n/translate"

import { formatCount, formatDuration } from "./format"

// The shipped English strings, so a change to the wording fails here rather than silently
// reformatting every duration on the board.
const t = createTranslate({
  UsageSummary: {
    DurationSeconds: "{0}s",
    DurationMinutes: "{0} min",
    DurationHoursMinutes: "{0}h {1}m",
    DurationHours: "{0}h",
  },
})

describe("formatDuration", () => {
  it("renders nothing at all as a bare zero", () => {
    // Not "0s": a row nobody has touched should not read as a row touched for no time.
    expect(formatDuration(0, t)).toBe("0")
    expect(formatDuration(-30, t)).toBe("0")
  })

  it("renders under a minute in seconds", () => {
    expect(formatDuration(1, t)).toBe("1s")
    expect(formatDuration(59, t)).toBe("59s")
  })

  it("renders under an hour in whole minutes, rounding down", () => {
    expect(formatDuration(60, t)).toBe("1 min")
    expect(formatDuration(119, t)).toBe("1 min")
    expect(formatDuration(3599, t)).toBe("59 min")
  })

  it("drops the minutes from a whole number of hours", () => {
    expect(formatDuration(3600, t)).toBe("1h")
    expect(formatDuration(7200, t)).toBe("2h")
  })

  it("keeps the leftover minutes when there are any", () => {
    expect(formatDuration(3660, t)).toBe("1h 1m")
    expect(formatDuration(9000, t)).toBe("2h 30m")
    // Seconds past the last whole minute are dropped rather than rounding the minute up.
    expect(formatDuration(3719, t)).toBe("1h 1m")
  })
})

describe("formatCount", () => {
  it("groups thousands the way the locale does", () => {
    expect(formatCount(12345, "en")).toBe("12,345")
    expect(formatCount(999, "en")).toBe("999")
  })
})
