// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { useI18nStore } from "@/i18n/store"

import type { SceneEdge } from "../model/scene"
import { EdgeBar, type EdgeBarProps } from "./EdgeBar"
import { englishMindmap } from "./panel/test-strings"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function edge(over: Partial<SceneEdge> = {}): SceneEdge {
  return { id: "e", fromId: "a", toId: "b", kind: "hierarchy", ...over }
}

function props(over: Partial<EdgeBarProps> = {}): EdgeBarProps {
  return {
    edge: edge(),
    count: 1,
    onStyle: vi.fn(),
    onLabel: vi.fn(),
    inherit: { inherited: true, color: "var(--branch-2)" },
    selectionKey: "e",
    ...over,
  }
}

let container: HTMLElement
let root: Root

beforeAll(() => useI18nStore.setState({ bundle: { Mindmap: englishMindmap() } }))
afterAll(() => useI18nStore.setState({ bundle: {} }))

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = (over: Partial<EdgeBarProps> = {}) => act(() => root.render(<EdgeBar {...props(over)} />))
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const press = (target: HTMLElement) => act(() => target.click())
const panel = (key: string) => container.querySelector(`[role="dialog"][data-panel="${key}"]`)!
const tile = (key: string, label: string) =>
  [...panel(key).querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label)!
const reach = (key: string) => panel(key).querySelector<HTMLButtonElement>('[role="switch"]')!

describe("styling an edge", () => {
  it("sends each choice down the branch only once the switch is on, on a hierarchy edge", () => {
    const onStyle = vi.fn()
    render({ onStyle })

    press(tile("line", "Dashed line"))
    expect(onStyle).toHaveBeenLastCalledWith({ line: "dashed" }, false)

    press(reach("line"))
    press(button("Bold"))
    expect(onStyle).toHaveBeenLastCalledWith({ thickness: 2.5 }, true)
    press(tile("route", "Straight"))
    expect(onStyle).toHaveBeenLastCalledWith({ routing: "straight" }, true)
    press(button("Color 4"))
    expect(onStyle).toHaveBeenLastCalledWith({ color: "palette.4" }, true)
  })

  it("never sends a cross-link's choices down, and offers no switch to", () => {
    const onStyle = vi.fn()
    render({ onStyle, edge: edge({ kind: "link" }) })
    expect(reach("line").disabled).toBe(true)
    press(tile("route", "Right-angle"))
    expect(onStyle).toHaveBeenLastCalledWith({ routing: "orthogonal" }, false)
  })

  it("never sends a cap down the branch, whatever another panel left the switch at", () => {
    const onStyle = vi.fn()
    render({ onStyle, edge: edge({ startCap: "dot", endCap: "arrow" }) })
    press(reach("line"))
    press(button("Start Arrow"))
    expect(onStyle).toHaveBeenLastCalledWith({ startCap: "arrow" }, false)
    press(button("End Dot"))
    expect(onStyle).toHaveBeenLastCalledWith({ endCap: "dot" }, false)
    press(tile("ends", "Swap"))
    expect(onStyle).toHaveBeenLastCalledWith({ startCap: "arrow", endCap: "dot" }, false)
  })

  it("offers no swap to several edges, which would copy one edge's caps onto the rest", () => {
    render({ count: 2 })
    expect(tile("ends", "Swap").disabled).toBe(true)
  })

  it("swaps both ends in one change", () => {
    const onStyle = vi.fn()
    render({ onStyle, edge: edge({ startCap: "dot", endCap: "arrow" }) })
    press(tile("ends", "Swap"))
    expect(onStyle).toHaveBeenCalledTimes(1)
    expect(onStyle).toHaveBeenLastCalledWith({ startCap: "arrow", endCap: "dot" }, false)
  })

  it("lights Auto while the edge inherits and clears its colour from it", () => {
    const onStyle = vi.fn()
    render({ onStyle, edge: edge({ color: "var(--branch-2)" }), inherit: { inherited: true, color: "var(--branch-2)" } })
    expect(button("Match the branch").getAttribute("aria-pressed")).toBe("true")
    expect(button("Color 2").getAttribute("aria-pressed")).toBe("false")

    render({ onStyle, edge: edge({ color: "var(--branch-2)" }), inherit: { inherited: false, color: "var(--branch-5)" } })
    expect(button("Color 2").getAttribute("aria-pressed")).toBe("true")
    press(button("Match the branch"))
    expect(onStyle).toHaveBeenLastCalledWith({ color: null }, false)
  })

  it("names Auto after the default colour on a cross-link", () => {
    render({ edge: edge({ kind: "link" }), inherit: { inherited: true, color: undefined } })
    expect(button("Default color")).not.toBeNull()
  })

  it("shows no weight picked on a branch left at the renderer's own weight", () => {
    render()
    const radios = [...panel("line").querySelectorAll('[role="radio"]')]
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "false"])
    expect(radios.map((radio) => radio.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"])
  })
})

describe("the label and the count", () => {
  it("starts a label on one edge and closes whatever panel was open", () => {
    const onLabel = vi.fn()
    render({ onLabel })
    press(button("Edge color"))
    press(button("Add label"))
    expect(onLabel).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="dialog"][aria-hidden="false"]')).toBeNull()
  })

  it("offers no label to several edges, and says how many there are", () => {
    render({ count: 3 })
    expect(button("Add label").disabled).toBe(true)
    expect(container.querySelector('[role="toolbar"]')!.textContent).toContain("3")
  })

  it("shows no count for a single edge, and names the label button after what it shows", () => {
    render({ edge: edge({ label: "why" }) })
    expect(button("Edit label: why")).not.toBeNull()
    expect(container.querySelector('[role="toolbar"]')!.textContent?.trim().endsWith("why")).toBe(true)
  })
})
