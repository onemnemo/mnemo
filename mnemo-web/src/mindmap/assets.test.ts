// @vitest-environment jsdom

/**
 * The rules a picture goes through on its way onto a map, without a server or a decoder involved.
 *
 * The sizing rule is the desktop's, and it is asserted rather than described because a photo dropped
 * on a map made in either app has to arrive the same size.
 */

import { describe, expect, it } from "vitest"

import { fitImageBox, IMAGE_FIT, imageFilesOf, mindmapImagePath } from "./assets"

const file = (name: string, type: string): File => new File([new Uint8Array([1])], name, { type })

/** Only `files` is read, and a real DataTransfer cannot be given any outside a live drag. */
const carrying = (...files: File[]): DataTransfer => ({ files }) as unknown as DataTransfer

describe("the box a placed picture gets", () => {
  it("scales a large one down whole, keeping its proportions", () => {
    const [width, height] = fitImageBox(1920, 1080)

    expect(width).toBeLessThanOrEqual(IMAGE_FIT.maxWidth)
    expect(height).toBeLessThanOrEqual(IMAGE_FIT.maxHeight)
    expect(width / height).toBeCloseTo(1920 / 1080, 1)
  })

  it("fits a tall one to its height rather than its width", () => {
    const [, height] = fitImageBox(400, 2000)

    expect(height).toBe(IMAGE_FIT.maxHeight)
  })

  it("leaves a small one the size it is", () => {
    expect(fitImageBox(64, 64)).toEqual([64, 64])
  })

  it("never draws a picture at nothing, however thin it is", () => {
    const [width, height] = fitImageBox(4000, 2)

    expect(width).toBeGreaterThanOrEqual(IMAGE_FIT.minSize)
    expect(height).toBeGreaterThanOrEqual(IMAGE_FIT.minSize)
  })

  it("gives a file that would not decode a box anyway", () => {
    expect(fitImageBox(0, 0)).toEqual([IMAGE_FIT.maxWidth / 2, IMAGE_FIT.maxHeight / 2])
  })
})

describe("where an asset is served from", () => {
  it("is the bare name, whatever else the id says", () => {
    expect(mindmapImagePath("a.png")).toBe("/api/mindmaps/assets/a.png")
    expect(mindmapImagePath("C:\\images\\a.png")).toBe("/api/mindmaps/assets/a.png")
    expect(mindmapImagePath("/var/data/a.png")).toBe("/api/mindmaps/assets/a.png")
  })

  it("escapes a name rather than letting it become more of the address", () => {
    expect(mindmapImagePath("a b?.png")).toBe("/api/mindmaps/assets/a%20b%3F.png")
  })

  it("is nowhere for an element pointing at nothing", () => {
    expect(mindmapImagePath("")).toBeNull()
    expect(mindmapImagePath(null)).toBeNull()
    expect(mindmapImagePath("   ")).toBeNull()
  })
})

describe("what a drop carries", () => {
  it("takes the pictures and leaves everything else", () => {
    const png = file("a.png", "image/png")
    const taken = imageFilesOf(carrying(png, file("notes.pdf", "application/pdf")))

    expect(taken).toEqual([png])
  })

  it("takes nothing from a drop that carried no files at all", () => {
    expect(imageFilesOf(null)).toEqual([])
    expect(imageFilesOf(carrying())).toEqual([])
  })
})
