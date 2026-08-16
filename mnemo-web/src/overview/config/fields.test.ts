import { describe, expect, it } from "vitest"

import type { WidgetSettingSchema } from "../widgets/manifest"
import { decodeAll, decodeField, encodeAll, encodeField } from "./fields"

const range: WidgetSettingSchema = {
  key: "days_to_show",
  labelKey: "SettingDaysToShow",
  type: "range",
  defaultValue: "7",
  minimum: 1,
  maximum: 90,
}

const choice: WidgetSettingSchema = {
  key: "sort_by",
  labelKey: "SettingSortBy",
  type: "choice",
  defaultValue: "date",
  options: [
    { value: "date", labelKey: "SettingSortByDate" },
    { value: "study_count", labelKey: "SettingSortByStudyCount" },
  ],
}

const toggle: WidgetSettingSchema = {
  key: "compact",
  labelKey: "SettingCompact",
  type: "toggle",
  defaultValue: "false",
}

describe("decodeField", () => {
  it("reads an absent key as the schema default, then parses it", () => {
    expect(decodeField(range, undefined)).toEqual({ type: "range", value: 7 })
    expect(decodeField(choice, {})).toEqual({ type: "choice", value: "date" })
    expect(decodeField(toggle, {})).toEqual({ type: "toggle", value: false })
  })

  it("clamps a range to its bounds", () => {
    expect(decodeField(range, { days_to_show: "500" })).toEqual({ type: "range", value: 90 })
    expect(decodeField(range, { days_to_show: "0" })).toEqual({ type: "range", value: 1 })
    expect(decodeField(range, { days_to_show: "30" })).toEqual({ type: "range", value: 30 })
  })

  it("falls a range that will not parse back to the minimum, not the default", () => {
    // The distinguishing case: the default is 7, the minimum is 1, and a garbage value takes the
    // minimum. A ladder that degraded to the default would answer 7 here.
    expect(decodeField(range, { days_to_show: "abc" })).toEqual({ type: "range", value: 1 })
    expect(decodeField(range, { days_to_show: "" })).toEqual({ type: "range", value: 1 })
  })

  it("falls a choice with no matching option back to the first option, not the default", () => {
    const other: WidgetSettingSchema = { ...choice, defaultValue: "study_count" }
    expect(decodeField(other, { sort_by: "nonsense" })).toEqual({ type: "choice", value: "date" })
  })

  it("reads a toggle case- and whitespace-insensitively, and off for anything else", () => {
    expect(decodeField(toggle, { compact: " TRUE " })).toEqual({ type: "toggle", value: true })
    expect(decodeField(toggle, { compact: "1" })).toEqual({ type: "toggle", value: false })
  })
})

describe("encodeField", () => {
  it("persists a range as an integer whatever the slider held", () => {
    expect(encodeField(range, { type: "range", value: 30 })).toBe("30")
    expect(encodeField(range, { type: "range", value: 6.5 })).toBe("7")
  })

  it("persists a toggle as the invariant literal", () => {
    expect(encodeField(toggle, { type: "toggle", value: true })).toBe("true")
    expect(encodeField(toggle, { type: "toggle", value: false })).toBe("false")
  })

  it("persists a choice, falling an empty selection back to the default", () => {
    expect(encodeField(choice, { type: "choice", value: "study_count" })).toBe("study_count")
    expect(encodeField(choice, { type: "choice", value: "" })).toBe("date")
  })
})

describe("decodeAll / encodeAll", () => {
  const schemas = [range, choice, toggle]

  it("round-trips a full bag", () => {
    const bag = { days_to_show: "14", sort_by: "study_count", compact: "true" }
    expect(encodeAll(schemas, decodeAll(schemas, bag))).toEqual(bag)
  })

  it("emits every key on save, not just the ones present in the bag", () => {
    // A save writes the complete set, so a widget that opened with a partial bag closes with a full
    // one, the defaults made explicit.
    expect(encodeAll(schemas, decodeAll(schemas, { sort_by: "study_count" }))).toEqual({
      days_to_show: "7",
      sort_by: "study_count",
      compact: "false",
    })
  })
})
