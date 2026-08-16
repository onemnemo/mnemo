import { describe, expect, it } from "vitest"

import type { TranslateFn } from "@/i18n/types"

import { greetingKeyForHour, greetingText } from "./greeting"

/** Echoes what was asked for, so a test can assert on the key and the argument, not on English. */
const t: TranslateFn = (ns, key, params) =>
  params === undefined ? `${ns}/${key}` : `${ns}/${key}(${Object.values(params).join(",")})`

/** Local time, because the greeting buckets on the local hour and the test must not depend on TZ. */
function at(hour: number, minute: number): Date {
  return new Date(2026, 6, 3, hour, minute, 0)
}

describe("greetingKeyForHour", () => {
  // The buckets are only ever wrong at their edges, and only for the one hour a day that lands
  // there, so the boundaries are the test.
  it.each([
    [4, "GreetingEvening"],
    [5, "GreetingMorning"],
    [11, "GreetingMorning"],
    [12, "GreetingAfternoon"],
    [17, "GreetingAfternoon"],
    [18, "GreetingEvening"],
    [0, "GreetingEvening"],
    [23, "GreetingEvening"],
  ])("buckets hour %i as %s", (hour, expected) => {
    expect(greetingKeyForHour(hour)).toBe(expected)
  })

  it("keeps the whole minute inside its hour's bucket", () => {
    expect(greetingText(at(4, 59), "Ada", t)).toBe("Overview/GreetingEvening(Ada)")
    expect(greetingText(at(5, 0), "Ada", t)).toBe("Overview/GreetingMorning(Ada)")
    expect(greetingText(at(11, 59), "Ada", t)).toBe("Overview/GreetingMorning(Ada)")
    expect(greetingText(at(12, 0), "Ada", t)).toBe("Overview/GreetingAfternoon(Ada)")
    expect(greetingText(at(17, 59), "Ada", t)).toBe("Overview/GreetingAfternoon(Ada)")
    expect(greetingText(at(18, 0), "Ada", t)).toBe("Overview/GreetingEvening(Ada)")
  })
})

describe("greetingText", () => {
  it("passes the trimmed name as the only argument", () => {
    expect(greetingText(at(9, 0), "  Ada  ", t)).toBe("Overview/GreetingMorning(Ada)")
  })

  // The Short variants are a separate key rather than the same key with an empty argument, so a
  // nameless greeting has to resolve a different string and pass nothing at all.
  it.each([
    ["", "empty"],
    ["   ", "whitespace"],
    ["\t\n", "blank control characters"],
  ])("uses the Short key with no argument for a %s name (%s)", (name) => {
    expect(greetingText(at(9, 0), name, t)).toBe("Overview/GreetingMorningShort")
    expect(greetingText(at(14, 0), name, t)).toBe("Overview/GreetingAfternoonShort")
    expect(greetingText(at(20, 0), name, t)).toBe("Overview/GreetingEveningShort")
  })
})
