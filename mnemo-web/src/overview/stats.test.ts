import { describe, expect, it } from "vitest"

import type { StatValueDto } from "@/api/types"

import { readInt, utcDayKey } from "./stats"

const fields = (entries: Record<string, StatValueDto>) => entries

describe("readInt", () => {
  it("reads an integer field", () => {
    expect(readInt(fields({ cards_reviewed: { type: "integer", value: "42" } }), "cards_reviewed")).toBe(42)
  })

  it("reads a missing field and a missing record as zero", () => {
    expect(readInt(fields({}), "cards_reviewed")).toBe(0)
    expect(readInt(undefined, "cards_reviewed")).toBe(0)
  })

  it.each<StatValueDto>([
    { type: "decimal", value: "42.5" },
    { type: "string", value: "42" },
    { type: "boolean", value: "true" },
    { type: "dateTime", value: "2026-08-08T00:00:00.0000000+00:00" },
  ])("reads a $type field as zero rather than coercing it", (value) => {
    // The tag is checked before the value, exactly as every desktop widget's own ReadInt does. A
    // field stored under the wrong type reads as absent in both apps, off the same row.
    expect(readInt(fields({ cards_reviewed: value }), "cards_reviewed")).toBe(0)
  })

  it("does not turn an unparseable integer into NaN", () => {
    // Not reachable from the endpoint, which serializes from a long. Guarded anyway because NaN
    // renders as the literal "NaN" in a tile rather than failing anywhere a reader would notice.
    expect(readInt(fields({ cards_reviewed: { type: "integer", value: "" } }), "cards_reviewed")).toBe(0)
  })
})

describe("utcDayKey", () => {
  it("keys the UTC day, not the local one", () => {
    // 23:30 on the 8th in UTC+2 is still the 8th in UTC; the naive local-date answer would be the
    // 9th and would read a row that does not exist yet.
    expect(utcDayKey(new Date("2026-08-08T21:30:00Z"))).toBe("2026-08-08")
    expect(utcDayKey(new Date("2026-08-08T23:30:00Z"))).toBe("2026-08-08")
    expect(utcDayKey(new Date("2026-08-09T00:10:00Z"))).toBe("2026-08-09")
  })

  it("zero-pads to the format the records are keyed by", () => {
    expect(utcDayKey(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05")
  })
})
