import { describe, expect, it } from "vitest"

import { EMOJI_CATEGORIES } from "./categories"
import { orderCategories, preferredCategories } from "./context"

describe("preferredCategories", () => {
  it("reads the subject out of a deck name", () => {
    expect(preferredCategories("Emergency Care and Transportation")[0]).toBe("medicine")
  })

  it("matches whole words only, so Cartography is not Art", () => {
    expect(preferredCategories("Cartography")).toEqual([])
  })

  it("ignores case and punctuation between words", () => {
    expect(preferredCategories("tysk_norsk_anki")).toContain("languages")
  })

  it("ranks the category with more hits first", () => {
    // Three medicine words against one science word.
    expect(preferredCategories("clinical anatomy and pathology, plus biology")[0]).toBe("medicine")
  })

  it("returns nothing when a name suggests nothing", () => {
    expect(preferredCategories("Deck 4")).toEqual([])
  })
})

describe("orderCategories", () => {
  it("leaves the declared order alone when nothing matches", () => {
    expect(orderCategories("Deck 4")).toEqual(EMOJI_CATEGORIES)
  })

  it("floats the matching category to the front without dropping any", () => {
    const order = orderCategories("Physics", ["study", "science", "people"])

    expect(order[0]).toBe("science")
    expect([...order].sort()).toEqual(["people", "science", "study"])
  })

  it("keeps recent pinned ahead of a context guess", () => {
    expect(orderCategories("Physics", ["recent", "study", "science"])[0]).toBe("recent")
  })

  it("does not invent recent when there is none to show", () => {
    expect(orderCategories("Physics", ["study", "science"])).not.toContain("recent")
  })
})
