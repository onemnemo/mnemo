import { describe, expect, it } from "vitest"

import { buildEmojiIndex } from "./dataset"
import { searchEmoji } from "./search"
import type { EmojiIndex } from "./types"

const BY_EMOJI = {
  "🎨": { name: "artist palette", group: "Activities" },
  "❤️": { name: "red heart", group: "Symbols" },
  "🛒": { name: "shopping cart", group: "Objects" },
  "⚛️": { name: "atom symbol", group: "Symbols" },
  "🧲": { name: "magnet", group: "Objects" },
}

const ORDERED = ["❤️", "🛒", "🎨", "⚛️", "🧲"]

const KEYWORDS = {
  "🎨": ["painting", "design"],
  "❤️": ["love"],
}

function index(): EmojiIndex {
  return buildEmojiIndex(BY_EMOJI, ORDERED, KEYWORDS)
}

function chars(query: string): string[] {
  return searchEmoji(index(), query).map((entry) => entry.char)
}

describe("searchEmoji", () => {
  it("returns nothing for a blank query", () => {
    expect(searchEmoji(index(), "   ")).toEqual([])
  })

  it("ranks a word match above a substring, so art beats heart and cart", () => {
    // "art" is inside "heart" and "cart" too, and both sort earlier in the data.
    expect(chars("art")[0]).toBe("🎨")
  })

  it("matches a word anywhere in the name, not just the first", () => {
    expect(chars("palette")).toContain("🎨")
  })

  it("finds emoji through a Mnemo alias the dataset does not carry", () => {
    const hits = chars("physics")

    expect(hits).toContain("⚛️")
    expect(hits).toContain("🧲")
  })

  it("ranks an exact keyword above a prefix match", () => {
    expect(chars("love")[0]).toBe("❤️")
  })

  it("finds an emoji by pasting the character itself", () => {
    expect(chars("🎨")).toEqual(["🎨"])
  })

  it("honours the limit", () => {
    expect(searchEmoji(index(), "a", 2)).toHaveLength(2)
  })
})
