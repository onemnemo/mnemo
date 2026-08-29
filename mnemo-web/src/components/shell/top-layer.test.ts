// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import { Z_LAYERS } from "@/lib/z-layers"

import { getTopLayer } from "./top-layer"

describe("the shared top layer", () => {
  it("appends one node to the document, at the layer reserved for it", () => {
    const layer = getTopLayer()

    expect(layer.parentElement).toBe(document.body)
    expect(layer.style.zIndex).toBe(String(Z_LAYERS.dialog))
  })

  it("returns the same node on every call, rather than a fresh one each time", () => {
    const first = getTopLayer()
    const second = getTopLayer()

    expect(second).toBe(first)
    expect(document.body.children.length).toBe(1)
  })
})
