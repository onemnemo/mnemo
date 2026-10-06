import { describe, expect, it } from "vitest"

import { BOX_HEIGHT_CAP, BOX_HEIGHT_FLOOR, boxHeight, stageLayout } from "./layout"

const IMAGE = { w: 1000, h: 680 }

describe("boxHeight", () => {
  it("reserves the answer and fits a large window", () => {
    // 800 tall: column 610 after the top bar, grade block and top padding; the chrome is the card
    // padding, one question line, and the stacked divider, label and back line.
    expect(boxHeight({ column: 610, chrome: 207, compact: false })).toBe(403)
  })

  it("caps the stacked box so a tall window does not stretch the image", () => {
    expect(boxHeight({ column: 2000, chrome: 207, compact: false })).toBe(BOX_HEIGHT_CAP)
  })

  it("takes all the room in the side by side layout", () => {
    expect(boxHeight({ column: 410, chrome: 106, compact: true })).toBe(304)
    expect(boxHeight({ column: 2000, chrome: 106, compact: true })).toBe(1894)
  })

  it("never collapses below the floor; the column scrolls instead", () => {
    expect(boxHeight({ column: 100, chrome: 207, compact: false })).toBe(BOX_HEIGHT_FLOOR)
    expect(boxHeight({ column: 100, chrome: 106, compact: true })).toBe(BOX_HEIGHT_FLOOR)
  })

  it("grows the box when the question is shorter and shrinks it when the answer is longer", () => {
    const base = boxHeight({ column: 500, chrome: 200, compact: false })
    expect(boxHeight({ column: 500, chrome: 150, compact: false })).toBeGreaterThan(base)
    expect(boxHeight({ column: 500, chrome: 260, compact: false })).toBeLessThan(base)
  })
})

describe("stageLayout", () => {
  it("spans the card when stacked and centres the fitted image in it", () => {
    const { box, fitted } = stageLayout({ natural: IMAGE, inner: 656, height: 403, compact: false })
    expect(box).toEqual({ w: 656, h: 403 })
    expect(fitted).toEqual({ w: 593, h: 403 })
  })

  it("hugs the image when side by side", () => {
    const { box, fitted } = stageLayout({ natural: IMAGE, inner: 656, height: 304, compact: true })
    expect(fitted).toEqual({ w: 447, h: 304 })
    expect(box).toEqual(fitted)
  })

  it("leaves room for the answer beside a wide image", () => {
    const wide = stageLayout({ natural: { w: 3000, h: 1000 }, inner: 656, height: 304, compact: true })
    expect(wide.box.w).toBeLessThanOrEqual(Math.floor(656 * 0.7))
  })

  it("uses a placeholder shape until the image has loaded", () => {
    const { fitted } = stageLayout({ natural: null, inner: 656, height: 300, compact: false })
    expect(fitted).toEqual({ w: 400, h: 300 })
  })
})
