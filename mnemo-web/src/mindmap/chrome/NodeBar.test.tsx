// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { useI18nStore } from "@/i18n/store"

import type { SceneElement } from "../model/scene"
import type { ColorControl } from "./color-control"
import { englishMindmap } from "./panel/test-strings"
import { NodeBar, type NodeActions, type NodeBarProps } from "./NodeBar"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function element(over: Partial<SceneElement> = {}): SceneElement {
  return {
    id: "a",
    kind: "node",
    content: { $type: "text", text: "a" },
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    depth: 1,
    branch: 0,
    nodeShape: "card",
    text: { lines: ["a"], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: false,
    childCount: 0,
    hiddenCount: 0,
    ...over,
  }
}

function actions(over: Partial<NodeActions> = {}): NodeActions {
  return {
    onPin: vi.fn(),
    collapse: null,
    onSaveTemplate: null,
    onOutdent: null,
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    deleteCount: 1,
    ...over,
  }
}

function color(over: Partial<ColorControl> = {}): ColorControl {
  return {
    slot: 3,
    color: "var(--branch-3)",
    inherited: true,
    inheritedColor: "var(--branch-3)",
    hasSubtree: true,
    below: 4,
    branching: true,
    onPick: vi.fn(),
    ...over,
  }
}

function props(over: Partial<NodeBarProps> = {}): NodeBarProps {
  return {
    element: element(),
    count: 1,
    onStyle: vi.fn(),
    color: color(),
    onKind: vi.fn(),
    actions: actions(),
    selectionKey: "a",
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

const render = (over: Partial<NodeBarProps> = {}) => act(() => root.render(<NodeBar {...props(over)} />))
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const press = (target: HTMLElement) => act(() => target.click())
const openPanel = () => container.querySelector('[role="dialog"][aria-hidden="false"]')?.getAttribute("data-panel") ?? null
const inPanel = (key: string) => container.querySelector(`[role="dialog"][data-panel="${key}"]`)!
const rows = (key: string) => [...inPanel(key).querySelectorAll("button")]
const text = (target: Element) => target.textContent?.trim() ?? ""
const row = (key: string, label: string) => rows(key).find((candidate) => text(candidate).startsWith(label))!
const escape = () => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))

describe("opening and closing panels", () => {
  it("opens each button's panel and closes it on a second press", () => {
    render()
    for (const [label, key] of [
      ["Text", "kind"],
      ["Branch color", "color"],
      ["Shape and size", "shape"],
      ["More", "more"],
    ]) {
      press(button(label))
      expect(openPanel()).toBe(key)
      expect(button(label).getAttribute("aria-expanded")).toBe("true")
      press(button(label))
      expect(openPanel()).toBeNull()
    }
  })

  it("swaps one panel for the next when another button is pressed", () => {
    render()
    press(button("Branch color"))
    press(button("More"))
    expect(openPanel()).toBe("more")
    expect(button("Branch color").getAttribute("aria-expanded")).toBe("false")
  })

  it("closes on Escape and hands a keyboard user back to the button that opened it", () => {
    render()
    button("Shape and size").focus()
    press(button("Shape and size"))
    act(() => (inPanel("shape").querySelector("button") as HTMLButtonElement).focus())
    escape()
    expect(openPanel()).toBeNull()
    expect(document.activeElement).toBe(button("Shape and size"))
  })

  it("never takes the focus on a press, so the map keeps its keys", () => {
    render()
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    act(() => void button("Shape and size").dispatchEvent(down))
    expect(down.defaultPrevented).toBe(true)
  })

  it("hands a keyboard user back to the opener when a row closes its own panel", () => {
    render()
    button("Text").focus()
    press(button("Text"))
    const task = row("kind", "Task")
    act(() => task.focus())
    press(task)
    expect(document.activeElement).toBe(button("Text"))
  })

  it("leaves Escape to a field being typed into", () => {
    render()
    press(button("More"))
    const field = document.createElement("input")
    document.body.appendChild(field)
    act(() => void field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(openPanel()).toBe("more")
    field.remove()
  })

  it("closes on a press outside the bar", () => {
    render()
    press(button("More"))
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })))
    expect(openPanel()).toBeNull()
  })

  it("closes when the selection moves to another node", () => {
    render()
    press(button("More"))
    render({ element: element({ id: "b" }), selectionKey: "b" })
    expect(openPanel()).toBeNull()
    // And stays shut when the selection comes back to where the panel was opened.
    render()
    expect(openPanel()).toBeNull()
  })
})

describe("the colour panel", () => {
  it("picks a hue with the whole-branch switch as it stands", () => {
    const control = color()
    render({ color: control })
    press(button("Branch color"))
    press(button("Color 2"))
    expect(control.onPick).toHaveBeenLastCalledWith("palette.2", false)

    press(inPanel("color").querySelector<HTMLButtonElement>('[role="switch"]')!)
    press(button("Color 5"))
    expect(control.onPick).toHaveBeenLastCalledWith("palette.5", true)
  })

  it("disables the switch when there is nothing under the node", () => {
    render({ color: color({ hasSubtree: false, below: 0 }) })
    expect(inPanel("color").querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true)
  })

  it("counts the nodes the switch would reach", () => {
    render({ color: color({ below: 4 }) })
    expect(inPanel("color").textContent).toContain("Also recolors the 4 nodes below")
  })

  it("lights Auto while the node inherits, and a hue once it has its own", () => {
    render({ color: color({ inherited: true }) })
    expect(button("Match the branch").getAttribute("aria-pressed")).toBe("true")
    expect(button("Color 3").getAttribute("aria-pressed")).toBe("false")

    render({ color: color({ inherited: false, slot: 3 }) })
    expect(button("Match the branch").getAttribute("aria-pressed")).toBe("false")
    expect(button("Color 3").getAttribute("aria-pressed")).toBe("true")
  })

  it("hands the node back to its branch from Auto", () => {
    const control = color({ inherited: false })
    render({ color: control })
    press(button("Match the branch"))
    expect(control.onPick).toHaveBeenLastCalledWith(null, false)
  })

  it("names Auto after the default colour on a node with no branch", () => {
    render({ color: color({ branching: false }) })
    expect(button("Default color")).not.toBeNull()
  })

  it("hides the colour button when there is no colour to set", () => {
    render({ color: null })
    expect(button("Branch color")).toBeNull()
  })
})

describe("the shape and size panel", () => {
  it("sets the shape and the text size", () => {
    const onStyle = vi.fn()
    render({ onStyle })
    press(row("shape", "Pill"))
    expect(onStyle).toHaveBeenLastCalledWith({ nodeShape: "pill" })
    press(button("Extra large"))
    expect(onStyle).toHaveBeenLastCalledWith({ fontScale: "xl" })
  })
})

describe("the kind button", () => {
  it("changes the kind and closes the panel", () => {
    const onKind = vi.fn()
    render({ onKind })
    press(button("Text"))
    press(row("kind", "Task"))
    expect(onKind).toHaveBeenCalledWith("task")
    expect(openPanel()).toBeNull()
  })

  it("shows the count and stays shut when several nodes are selected", () => {
    render({ count: 3, onKind: null })
    const kind = button("3 nodes")
    expect(kind.disabled).toBe(true)
    expect(kind.getAttribute("aria-expanded")).toBeNull()
  })
})

describe("the More panel", () => {
  it("puts Pin first and flips it", () => {
    const onPin = vi.fn()
    render({ actions: actions({ onPin }), element: element({ pinned: true }) })
    press(button("More"))
    expect(text(rows("more")[0])).toBe("Unpin")
    press(rows("more")[0])
    expect(onPin).toHaveBeenCalledWith(false)
    expect(openPanel()).toBeNull()
  })

  it("leaves out the rows whose action is missing", () => {
    render()
    const labels = rows("more").map(text)
    expect(labels).toEqual(["Pin", "Duplicate", "Delete"])
  })

  it("offers every row when every action is there", () => {
    render({
      actions: actions({
        collapse: { collapsed: false, onToggle: vi.fn() },
        onOutdent: vi.fn(),
        onSaveTemplate: vi.fn(),
      }),
    })
    const labels = rows("more").map(text)
    expect(labels).toEqual(["Pin", "Collapse branch", "Outdent", "Duplicate", "Save style as template", "Delete"])
  })

  it("counts what a delete actually reaches once it is more than one node", () => {
    const onDelete = vi.fn()
    render({ actions: actions({ deleteCount: 4, onDelete }) })
    press(button("More"))
    press(row("more", "Delete"))
    expect(onDelete).toHaveBeenCalledTimes(1)
    render({ actions: actions({ deleteCount: 4, onDelete }) })
    expect(text(row("more", "Delete"))).toBe("Delete 4 nodes")
  })
})

describe("the toolbar", () => {
  it("walks its buttons with the arrow keys", () => {
    render()
    button("Text").focus()
    const key = (name: string) =>
      act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })))
    key("ArrowRight")
    expect(document.activeElement).toBe(button("Branch color"))
    key("End")
    expect(document.activeElement).toBe(button("More"))
    key("ArrowRight")
    expect(document.activeElement).toBe(button("Text"))
  })
})
