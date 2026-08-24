// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

// The message names are the contract with Mnemo.Host/Chrome/WindowChrome.cs, so
// this pins the wire shape rather than the function that produces it.
describe("reportDragRegions", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("sends one chrome.drag-regions message carrying both lists", async () => {
    const sent: string[] = []
    vi.stubGlobal("external", { sendMessage: (message: string) => sent.push(message) })
    vi.resetModules()
    const { reportDragRegions } = await import("./window")

    reportDragRegions([{ x: 0, y: 0, w: 800, h: 48 }], [{ x: 750, y: 10, w: 40, h: 28 }])

    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0])).toEqual({
      type: "chrome.drag-regions",
      drag: [{ x: 0, y: 0, w: 800, h: 48 }],
      noDrag: [{ x: 750, y: 10, w: 40, h: 28 }],
    })
  })
})
