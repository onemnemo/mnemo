// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PostRevealHint, PreRevealHint } from "./KeyHints"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const keys = () => [...host.querySelectorAll("kbd")].map((kbd) => kbd.textContent)

describe("the key hint row", () => {
  it("lists edit, undo and end before the reveal on an ordinary card", () => {
    act(() => root.render(<PreRevealHint />))

    expect(keys()).toEqual(["E", expect.stringMatching(/Z$/), "Esc"])
  })

  it("adds M between edit and undo for a hide all occlusion card", () => {
    act(() => root.render(<PreRevealHint showMasks />))

    expect(keys()).toEqual(["E", "M", expect.stringMatching(/Z$/), "Esc"])
    expect(host.textContent).toContain("StudyHintShowMasks")
  })

  it("leaves M out of the row after the reveal", () => {
    act(() => root.render(<PostRevealHint />))

    expect(keys()).not.toContain("M")
  })
})
