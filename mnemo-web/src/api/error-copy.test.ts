import { describe, expect, it } from "vitest"

import { KeyedError } from "@/i18n/keyed-error"
import { mergedEnglishBundle, resolves } from "@/i18n/test-bundle"
import type { TranslateFn } from "@/i18n/types"

import { ApiError } from "./client"
import { describeError, ERROR_KEYS } from "./error-copy"

/** Names what it was asked for, so the assertion reads which key was reached. */
const t: TranslateFn = (ns, key) => `${ns}.${key}`

describe("describeError", () => {
  it("puts the shared words to a code this build knows", () => {
    const refused = new ApiError("No deck 'abc'.", 404, "unknown_deck")

    expect(describeError(t, refused)).toBe("Errors.UnknownDeck")
  })

  it("lets a surface's own wording for a code win over the shared sentence", () => {
    const refused = new ApiError("This preset is still used by one or more decks.", 409, "preset_in_use")

    expect(describeError(t, refused, { preset_in_use: "own words" })).toBe("own words")
    expect(describeError(t, refused, { unknown_deck: "not this code" })).toBe("Errors.PresetInUse")
  })

  it("keeps the server's sentence for a code it does not know, so a newer host still says something", () => {
    expect(describeError(t, new ApiError("Something newer.", 400, "brand_new_code"))).toBe("Something newer.")
  })

  it("uses translated fallback copy when no stable server code arrived", () => {
    expect(describeError(t, new ApiError("Bad Gateway", 502))).toBe("Errors.RequestFailed")
  })

  it("reads a keyed client failure through its own namespace", () => {
    expect(describeError(t, new KeyedError("Mindmap", "ExportNothingToDraw"))).toBe("Mindmap.ExportNothingToDraw")
  })

  it("uses translated fallback copy for a plain error and ignores values that are not errors", () => {
    expect(describeError(t, new Error("Failed to fetch"))).toBe("Errors.RequestFailed")
    expect(describeError(t, "a string")).toBeUndefined()
    expect(describeError(t, undefined)).toBeUndefined()
  })
})

describe("the shared error copy", () => {
  // The table is the client's promise to word a code; a key without a sentence would print as
  // the key itself, which is worse than the English it replaces.
  it("ships a sentence for every code it names", () => {
    const bundle = mergedEnglishBundle()
    for (const [code, key] of Object.entries(ERROR_KEYS)) {
      expect(resolves(bundle, "Errors", key), `${code} -> ${key}`).toBe(true)
    }
  })
})
