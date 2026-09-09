import { describe, expect, it } from "vitest"

import { createFontEpoch, type FontLoading } from "./fonts"

/** A font set whose loading periods a test ends by hand. */
function fontSet(status: FontLoading["status"]): FontLoading & { settle: () => void } {
  const done: (() => void)[] = []
  return {
    status,
    addEventListener: (_type, listener) => {
      done.push(listener)
    },
    settle: () => {
      for (const listener of done) listener()
    },
  }
}

describe("the font epoch", () => {
  it("starts at zero while the first fonts are still loading, and moves past it when they land", () => {
    const fonts = fontSet("loading")
    const epoch = createFontEpoch(fonts)

    expect(epoch.current()).toBe(0)
    fonts.settle()
    expect(epoch.current()).toBe(1)
  })

  it("starts past zero when nothing was loading, so a warm cache never waits", () => {
    expect(createFontEpoch(fontSet("loaded")).current()).toBe(1)
  })

  it("starts past zero with no font set at all", () => {
    expect(createFontEpoch(null).current()).toBe(1)
  })

  it("moves on for every later batch and tells its subscribers each time", () => {
    const fonts = fontSet("loaded")
    const epoch = createFontEpoch(fonts)
    let heard = 0
    const stop = epoch.subscribe(() => {
      heard += 1
    })

    fonts.settle()
    fonts.settle()
    expect(epoch.current()).toBe(3)
    expect(heard).toBe(2)

    stop()
    fonts.settle()
    expect(heard).toBe(2)
  })
})
