import { describe, expect, it } from "vitest"

import type { WidgetSettingSchema } from "../widgets/manifest"
import { fromBool, fromInt, getBool, getInt, getString, settingInt, settingString } from "./encode"

const days: WidgetSettingSchema = {
  key: "days_to_show",
  labelKey: "SettingDaysToShow",
  type: "range",
  defaultValue: "7",
  minimum: 1,
  maximum: 90,
}

const sortBy: WidgetSettingSchema = {
  key: "sort_by",
  labelKey: "SettingSortBy",
  type: "choice",
  defaultValue: "date",
  options: [
    { value: "date", labelKey: "SettingSortByDate" },
    { value: "modified", labelKey: "SettingSortByModified" },
  ],
}

const enabled: WidgetSettingSchema = {
  key: "enabled",
  labelKey: "SettingEnabled",
  type: "toggle",
  defaultValue: "true",
}

describe("getString", () => {
  it("prefers the stored value", () => {
    expect(getString({ sort_by: "modified" }, sortBy)).toBe("modified")
  })

  it.each<Record<string, string> | undefined>([undefined, {}, { sort_by: "" }, { sort_by: "   " }])(
    "falls back to the schema default when the bag says nothing (%j)",
    (bag) => {
      // Whitespace counts as absent, which is the desktop's rule. Treating "   " as a stored value
      // would make a widget configured on one app read blank on the other.
      expect(getString(bag, sortBy)).toBe("date")
    },
  )
})

describe("getInt", () => {
  it("parses a stored integer", () => {
    expect(getInt({ days_to_show: "30" }, days)).toBe(30)
    expect(getInt({ days_to_show: " 30 " }, days)).toBe(30)
    expect(getInt({ days_to_show: "-4" }, days)).toBe(-4)
  })

  it.each(["3.5", "1e3", "0x10", "seven", "  "])(
    "falls back to the schema default for %s, which int.TryParse also rejects",
    (stored) => {
      // Number() would accept every one of these. The desktop parses with NumberStyles.Integer and
      // gets 7; matching that is the whole point of the regex.
      expect(getInt({ days_to_show: stored }, days)).toBe(7)
    },
  )

  it("falls back to zero when the schema default is itself unparseable", () => {
    expect(getInt({}, { ...days, defaultValue: "many" })).toBe(0)
  })
})

describe("getBool", () => {
  it.each([
    ["true", true],
    ["TRUE", true],
    [" false ", false],
  ] as const)("parses %s", (stored, expected) => {
    expect(getBool({ enabled: stored }, enabled)).toBe(expected)
  })

  it("falls back through the schema default to false", () => {
    expect(getBool({ enabled: "yes" }, enabled)).toBe(true)
    expect(getBool({ enabled: "yes" }, { ...enabled, defaultValue: "no" })).toBe(false)
  })
})

describe("encoding back", () => {
  it("writes culture-invariant values", () => {
    expect(fromInt(30)).toBe("30")
    expect(fromInt(7.9)).toBe("7")
    expect(fromBool(true)).toBe("true")
    expect(fromBool(false)).toBe("false")
  })
})

describe("settings read through a manifest", () => {
  const manifest = { settings: [days, sortBy] }

  it("resolves a declared setting", () => {
    expect(settingInt(manifest, { days_to_show: "14" }, "days_to_show")).toBe(14)
    expect(settingString(manifest, {}, "sort_by")).toBe("date")
  })

  it("yields the empty value for a setting the widget does not declare", () => {
    // There is no schema to take a default from, so this matches the desktop rather than inventing
    // one. A widget asking for a setting it never declared is a bug in the widget.
    expect(settingInt(manifest, { limit: "5" }, "limit")).toBe(0)
    expect(settingString(manifest, { limit: "5" }, "limit")).toBe("")
  })
})
