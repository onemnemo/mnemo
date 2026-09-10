// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"

vi.mock("@/notes/editor/atoms/katex", () => ({ renderMath: vi.fn() }))

import { sceneMeasurers } from "./measurers"

describe("sceneMeasurers", () => {
  it("replaces the measurer identity when the font epoch changes", () => {
    const first = sceneMeasurers(41)

    expect(sceneMeasurers(41)).toBe(first)
    expect(sceneMeasurers(42)).not.toBe(first)
  })
})
