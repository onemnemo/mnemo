import { afterEach, describe, expect, it } from "vitest"

import { formatCount, pluralKey, tPlural } from "@/i18n/plural"
import { useI18nStore } from "@/i18n/store"
import type { TranslateFn } from "@/i18n/types"

const KEYS = { one: "CardsAddedOne", many: "CardsAddedMany" }

const t: TranslateFn = (ns, key, params) =>
  `${ns}.${key}(${Object.entries(params ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join(",")})`

describe("pluralKey", () => {
  afterEach(() => useI18nStore.setState({ language: "en" }))

  it.each(["en", "de", "es", "nb"])("reads the one key only for a single item in %s", (locale) => {
    expect(pluralKey(KEYS, 1, locale)).toBe(KEYS.one)
    expect(pluralKey(KEYS, 0, locale)).toBe(KEYS.many)
    expect(pluralKey(KEYS, 2, locale)).toBe(KEYS.many)
    expect(pluralKey(KEYS, 21, locale)).toBe(KEYS.many)
  })

  it("always reads the many key in Japanese, which has one form", () => {
    expect(pluralKey(KEYS, 1, "ja")).toBe(KEYS.many)
    expect(pluralKey(KEYS, 5, "ja")).toBe(KEYS.many)
  })

  it("follows the active language when no locale is given", () => {
    useI18nStore.setState({ language: "ja" })
    expect(pluralKey(KEYS, 1)).toBe(KEYS.many)
    useI18nStore.setState({ language: "nb" })
    expect(pluralKey(KEYS, 1)).toBe(KEYS.one)
  })

  it("falls back to English rules for a tag Intl cannot read", () => {
    expect(pluralKey(KEYS, 1, "not a locale")).toBe(KEYS.one)
  })
})

describe("tPlural", () => {
  it("fills in the count beside the other params", () => {
    expect(tPlural(t, "TransferWarnings", KEYS, 12, { deckName: "Spanish" }, "en")).toBe(
      "TransferWarnings.CardsAddedMany(deckName=Spanish,count=12)",
    )
    expect(tPlural(t, "TransferWarnings", KEYS, 1, undefined, "en")).toBe("TransferWarnings.CardsAddedOne(count=1)")
  })

  it("lets the count win over a param of the same name", () => {
    expect(tPlural(t, "TransferWarnings", KEYS, 3, { count: 99 }, "en")).toBe("TransferWarnings.CardsAddedMany(count=3)")
  })

  it("writes the count the way the language groups its digits", () => {
    expect(tPlural(t, "TransferWarnings", KEYS, 12345, undefined, "de")).toBe(
      `TransferWarnings.CardsAddedMany(count=${formatCount(12345, "de")})`,
    )
  })
})

describe("formatCount", () => {
  afterEach(() => useI18nStore.setState({ language: "en" }))

  it("groups digits for the language it is given", () => {
    expect(formatCount(12345, "en")).toBe("12,345")
    expect(formatCount(12345, "de")).toBe("12.345")
  })

  it("follows the active language rather than the browser's when no locale is given", () => {
    useI18nStore.setState({ language: "de" })
    expect(formatCount(12345)).toBe("12.345")
  })

  it("falls back to English grouping for a tag Intl cannot read", () => {
    expect(formatCount(12345, "not a locale")).toBe("12,345")
  })
})
