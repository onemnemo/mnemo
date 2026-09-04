// @vitest-environment jsdom

/**
 * Which presses pan the canvas rather than changing the selection.
 *
 * `isMac` is decided once, when @/keybinds/chord loads, so a suite that imports it plainly pins
 * whichever machine happens to run it. The non-Mac case is the static import below; the Mac case
 * gets its own copy of the module, matching the pattern in keybinds/chord.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// Hoisted above the import below, which is the only window in which `navigator` can be set for
// a module that reads it as it loads.
vi.hoisted(() => {
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "" })
})

import { onNode, panModifier } from "./pan-gesture"

/** A press event stand-in; only the two modifier flags panModifier reads. */
function press(over: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {}) {
  return { ctrlKey: false, metaKey: false, ...over }
}

describe("panModifier off macOS", () => {
  it("pans on Ctrl", () => {
    expect(panModifier(press({ ctrlKey: true }))).toBe(true)
  })

  it("does not pan on the bare Cmd/Meta key, which is not the platform's secondary click here", () => {
    expect(panModifier(press({ metaKey: true }))).toBe(false)
  })

  it("does not pan with neither modifier held", () => {
    expect(panModifier(press())).toBe(false)
  })
})

describe("panModifier on macOS", () => {
  // Its own copy of the module: one process can only see one platform per instance, and the
  // static import above is already the Windows one.
  let mac: typeof import("./pan-gesture")

  beforeAll(async () => {
    vi.stubGlobal("navigator", { platform: "MacIntel", userAgent: "" })
    vi.resetModules()
    mac = await import("./pan-gesture")
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it("pans on Cmd, leaving Ctrl free to open a menu", () => {
    expect(mac.panModifier(press({ metaKey: true }))).toBe(true)
    expect(mac.panModifier(press({ ctrlKey: true }))).toBe(false)
  })
})

describe("onNode", () => {
  it("is true for a press on a node's own element", () => {
    const node = document.createElement("div")
    node.className = "mm-node"
    document.body.append(node)

    expect(onNode(node)).toBe(true)
    node.remove()
  })

  it("is true for a press on something a node contains", () => {
    const node = document.createElement("div")
    node.className = "mm-node"
    const label = document.createElement("span")
    node.append(label)
    document.body.append(node)

    expect(onNode(label)).toBe(true)
    node.remove()
  })

  it("is false for a press over the bare canvas", () => {
    const canvas = document.createElement("div")
    canvas.className = "mm-canvas"
    document.body.append(canvas)

    expect(onNode(canvas)).toBe(false)
    canvas.remove()
  })

  it("is false for a null target", () => {
    expect(onNode(null)).toBe(false)
  })
})
