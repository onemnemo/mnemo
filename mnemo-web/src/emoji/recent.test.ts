// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

import { RECENT_LIMIT, readRecentEmoji, rememberEmoji } from "./recent"

const STORAGE_KEY = "mnemo.emoji.recent"

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe("readRecentEmoji", () => {
  it("is empty before anything is picked", () => {
    expect(readRecentEmoji()).toEqual([])
  })

  it("ignores a value written by something else", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "a list" }))

    expect(readRecentEmoji()).toEqual([])
  })

  it("ignores unparsable content rather than throwing into the picker", () => {
    localStorage.setItem(STORAGE_KEY, "{oh no")

    expect(readRecentEmoji()).toEqual([])
  })

  it("drops non-string members", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["🧬", 7, null, "🔬"]))

    expect(readRecentEmoji()).toEqual(["🧬", "🔬"])
  })

  it("survives storage being unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })

    expect(readRecentEmoji()).toEqual([])
  })
})

describe("rememberEmoji", () => {
  it("puts the newest pick first", () => {
    rememberEmoji("🧬")

    expect(rememberEmoji("🔬")).toEqual(["🔬", "🧬"])
  })

  it("moves a repeat pick to the front instead of duplicating it", () => {
    rememberEmoji("🧬")
    rememberEmoji("🔬")

    expect(rememberEmoji("🧬")).toEqual(["🧬", "🔬"])
  })

  it("caps the list", () => {
    for (let i = 0; i < RECENT_LIMIT + 5; i += 1) rememberEmoji(String.fromCodePoint(0x1f600 + i))

    expect(readRecentEmoji()).toHaveLength(RECENT_LIMIT)
  })

  it("still returns the new list when the write is refused", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full")
    })

    expect(rememberEmoji("🧬")).toEqual(["🧬"])
  })
})
