// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { rasterize } from "./raster"

class UnreadableImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(_value: string) {
    queueMicrotask(() => this.onerror?.())
  }
}

describe("rasterize", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", UnreadableImage)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:map")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it("carries a translation key when the SVG cannot be drawn", async () => {
    await expect(rasterize({ markup: "<svg/>", width: 100, height: 100 })).rejects.toMatchObject({
      ns: "Mindmap",
      key: "ExportDrawFailed",
    })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:map")
  })
})
