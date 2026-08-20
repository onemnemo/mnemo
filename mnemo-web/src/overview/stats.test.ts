import { describe, expect, it } from "vitest"

import type { StatValueDto } from "@/api/types"

import { readDateTime, readInt, studyDayKey, studyDayWindow } from "./stats"

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

describe("readDateTime", () => {
  it("reads the round-trip format the store writes", () => {
    const value: StatValueDto = { type: "dateTime", value: "2026-08-08T21:30:00.0000000+00:00" }
    expect(readDateTime(fields({ last_practiced: value }), "last_practiced")).toBe(Date.parse("2026-08-08T21:30:00Z"))
  })

  it("keeps a non-UTC offset rather than reading the wall clock", () => {
    const value: StatValueDto = { type: "dateTime", value: "2026-08-08T23:30:00.0000000+02:00" }
    expect(readDateTime(fields({ last_practiced: value }), "last_practiced")).toBe(Date.parse("2026-08-08T21:30:00Z"))
  })

  it.each<StatValueDto>([
    { type: "integer", value: "1786000000000" },
    { type: "string", value: "2026-08-08T21:30:00Z" },
  ])("reports a $type field as absent rather than coercing it", (value) => {
    expect(readDateTime(fields({ last_practiced: value }), "last_practiced")).toBeUndefined()
  })

  it("reports a missing field and an unparseable one as absent", () => {
    expect(readDateTime(fields({}), "last_practiced")).toBeUndefined()
    expect(readDateTime(undefined, "last_practiced")).toBeUndefined()
    expect(readDateTime(fields({ last_practiced: { type: "dateTime", value: "yesterday" } }), "last_practiced"))
      .toBeUndefined()
  })
})

/**
 * Instants are built from local parts rather than parsed from a UTC string, because a study day is
 * a local day: the expectations below have to mean the same thing whatever zone the suite runs in.
 */
const local = (year: number, month: number, day: number, hour: number, minute = 0) =>
  new Date(year, month - 1, day, hour, minute)

describe("studyDayKey", () => {
  it("ends the day at the rollover hour, not at midnight", () => {
    // Late on the 8th and the small hours of the 9th are one study day, which is what the study
    // screen caps against. Keying by the calendar date instead splits that evening in two.
    expect(studyDayKey(local(2026, 8, 8, 21, 30), 4)).toBe("2026-08-08")
    expect(studyDayKey(local(2026, 8, 9, 0, 10), 4)).toBe("2026-08-08")
    expect(studyDayKey(local(2026, 8, 9, 3, 59), 4)).toBe("2026-08-08")
    expect(studyDayKey(local(2026, 8, 9, 4, 0), 4)).toBe("2026-08-09")
  })

  it("reads hour zero as plain midnight, which is what turning the setting down asks for", () => {
    expect(studyDayKey(local(2026, 8, 9, 0, 10), 0)).toBe("2026-08-09")
    expect(studyDayKey(local(2026, 8, 8, 23, 50), 0)).toBe("2026-08-08")
  })

  it("zero-pads to the format the records are keyed by", () => {
    expect(studyDayKey(local(2026, 1, 5, 12, 0), 4)).toBe("2026-01-05")
  })

  it("falls back to the default rather than to an invalid day for an unusable hour", () => {
    expect(studyDayKey(local(2026, 8, 9, 2, 0), Number.NaN)).toBe("2026-08-08")
    expect(studyDayKey(local(2026, 8, 9, 2, 0), -5)).toBe("2026-08-09")
    expect(studyDayKey(local(2026, 8, 9, 2, 0), 99)).toBe("2026-08-08")
  })
})

describe("studyDayWindow", () => {
  it("counts today as one of the days", () => {
    // A weekly window is [today-6, today], seven keys. Asking for today-7 would pull an eighth day
    // and inflate every weekly total, which is exactly the off-by-one the desktop does not have.
    expect(studyDayWindow(7, local(2026, 8, 8, 10, 0), 4)).toEqual({ from: "2026-08-02", to: "2026-08-08" })
  })

  it("reads a single day as today alone", () => {
    expect(studyDayWindow(1, local(2026, 8, 8, 10, 0), 4)).toEqual({ from: "2026-08-08", to: "2026-08-08" })
  })

  it("moves the whole window when the instant is before the rollover hour", () => {
    expect(studyDayWindow(7, local(2026, 8, 8, 1, 0), 4)).toEqual({ from: "2026-08-01", to: "2026-08-07" })
  })

  it("crosses a month and a year boundary by calendar, not by arithmetic on the key", () => {
    expect(studyDayWindow(7, local(2026, 3, 3, 10, 0), 4)).toEqual({ from: "2026-02-25", to: "2026-03-03" })
    expect(studyDayWindow(30, local(2026, 1, 10, 10, 0), 4)).toEqual({ from: "2025-12-12", to: "2026-01-10" })
  })

  it("floors a stored period of zero or less at one day", () => {
    // The bag can hold anything a past build wrote. A window of zero days would ask the endpoint
    // for a range ending before it starts, which is a 400 rather than an empty widget.
    expect(studyDayWindow(0, local(2026, 8, 8, 10, 0), 4)).toEqual({ from: "2026-08-08", to: "2026-08-08" })
    expect(studyDayWindow(-5, local(2026, 8, 8, 10, 0), 4)).toEqual({ from: "2026-08-08", to: "2026-08-08" })
  })
})
