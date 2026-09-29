// @vitest-environment jsdom

/**
 * The toolbar, mounted. The stores are left as they are: with no bundle loaded a translation is its
 * own key, which is what the labels below are, and with no catalog loaded a tool has no chord.
 */

import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useKeybindStore } from "@/keybinds/store"
import type { Keybind } from "@/keybinds/types"

import { DEFAULT_CONNECTOR } from "./connector"
import { MindmapToolbar, type MindmapToolbarProps, type ToolbarCommands } from "./MindmapToolbar"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let stage: HTMLDivElement
let root: Root

beforeEach(() => {
  stage = document.createElement("div")
  stage.getBoundingClientRect = () => new DOMRect(0, 0, 1200, 800)
  document.body.appendChild(stage)
  root = createRoot(stage)
})

afterEach(() => {
  act(() => root.unmount())
  stage.remove()
})

function mount(over: Partial<MindmapToolbarProps> = {}): MindmapToolbarProps {
  const stageRef = createRef<HTMLElement>() as { current: HTMLElement | null }
  stageRef.current = stage
  const all: MindmapToolbarProps = {
    tool: "select",
    onTool: vi.fn(),
    selectMode: "box",
    onSelectMode: vi.fn(),
    shape: "rectangle",
    onShape: vi.fn(),
    nodeStyle: null,
    onNodeStyle: vi.fn(),
    connector: DEFAULT_CONNECTOR,
    onConnector: vi.fn(),
    onInsertImage: vi.fn(),
    stage: stageRef,
    corner: createRef<HTMLElement>(),
    edge: "bottom",
    onEdge: vi.fn(),
    ...over,
  }
  act(() => root.render(<MindmapToolbar {...all} />))
  return all
}

function rerender(all: MindmapToolbarProps, over: Partial<MindmapToolbarProps>): void {
  act(() => root.render(<MindmapToolbar {...all} {...over} />))
}

function button(label: string, scope: ParentNode = stage): HTMLButtonElement {
  const found = scope.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(found, label).not.toBeNull()
  return found!
}

const press = (label: string, scope?: ParentNode) => act(() => button(label, scope).click())

function shelf(label: string): HTMLElement {
  return stage.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)!
}

const isOpen = (label: string) => !shelf(label).hasAttribute("inert")

function key(init: KeyboardEventInit, target: EventTarget = stage): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
  act(() => void target.dispatchEvent(event))
  return event
}

describe("the toolbar", () => {
  it("arms Shapes and puts its eight shapes on a shelf", () => {
    const all = mount()

    press("ToolShape")

    expect(all.onTool).toHaveBeenCalledWith("shape")
    expect(isOpen("ToolShape")).toBe(true)
    expect(shelf("ToolShape").querySelectorAll("button")).toHaveLength(8)
  })

  it("puts the shelf away when the armed tool is pressed again, and leaves the tool armed", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })

    press("ToolShape")

    expect(isOpen("ToolShape")).toBe(false)
    expect(all.onTool).toHaveBeenCalledTimes(1)
  })

  it("puts the shelf away on Escape, without Escape reaching the map", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })
    const reachedMap = vi.fn()
    stage.addEventListener("keydown", reachedMap)

    key({ key: "Escape" })

    expect(isOpen("ToolShape")).toBe(false)
    expect(reachedMap).not.toHaveBeenCalled()
  })

  it("puts the shelf away on a press anywhere outside the toolbar", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })
    const canvas = document.createElement("div")
    stage.appendChild(canvas)

    act(() => void canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })))

    expect(isOpen("ToolShape")).toBe(false)
  })

  it("puts the shelf away when another tool is armed from outside the toolbar", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })

    rerender(all, { tool: "text" })

    expect(isOpen("ToolShape")).toBe(false)
  })

  it("picks a shape by its number, puts the shelf away, and keeps the number from the map", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })
    const reachedMap = vi.fn()
    stage.addEventListener("keydown", reachedMap)

    key({ key: "4" })

    expect(all.onShape).toHaveBeenCalledWith("hexagon")
    // Left open, the shelf would take the next digit as another shape.
    expect(isOpen("ToolShape")).toBe(false)
    expect(reachedMap).not.toHaveBeenCalled()
  })

  it("hears a group's keys while nothing has the focus, but not keys aimed at other chrome", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })
    const elsewhere = document.createElement("button")
    document.body.append(elsewhere)
    try {
      key({ key: "2" }, elsewhere)
      expect(all.onShape).not.toHaveBeenCalled()
      key({ key: "2" }, document.body)
      expect(all.onShape).toHaveBeenCalledWith("ellipse")
    } finally {
      elsewhere.remove()
    }
  })

  it("picks a connector by its number without the number reaching the map", () => {
    const all = mount()
    press("ToolConnect")
    rerender(all, { tool: "connect" })
    const reachedMap = vi.fn()
    stage.addEventListener("keydown", reachedMap)

    key({ key: "2" })

    expect(all.onConnector).toHaveBeenCalledWith({ ...DEFAULT_CONNECTOR, routing: "straight" })
    expect(reachedMap).not.toHaveBeenCalled()
  })

  it("leaves keys alone under a modifier and inside a field being typed into", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })
    const field = document.createElement("input")
    stage.appendChild(field)

    key({ key: "4", ctrlKey: true })
    key({ key: "4" }, field)

    expect(all.onShape).not.toHaveBeenCalled()
  })

  it("shows the connector's route and switches as pressed or not", () => {
    mount({ tool: "connect", connector: { routing: "orthogonal", ends: "both", dashed: false } })
    const group = shelf("GroupConnectors")

    expect(button("RouteOrthogonal", group).getAttribute("aria-pressed")).toBe("true")
    expect(button("RouteCurve", group).getAttribute("aria-pressed")).toBe("false")
    expect(button("EdgeEndArrow", group).getAttribute("aria-pressed")).toBe("true")
    expect(button("ConnectorBothEnds", group).getAttribute("aria-pressed")).toBe("true")
    expect(button("EdgeDashed", group).getAttribute("aria-pressed")).toBe("false")
  })

  it("hands new nodes back to the template when the picked style is pressed again", () => {
    const all = mount({ tool: "node", nodeStyle: "pill" })
    press("ToolNode")
    const group = shelf("GroupNodeStyle")

    press("ShapePill", group)
    expect(all.onNodeStyle).toHaveBeenLastCalledWith(null)

    press("ShapeOutline", group)
    expect(all.onNodeStyle).toHaveBeenLastCalledWith("outline")
  })

  it("opens the picker for Image without arming anything or moving the chip", () => {
    const all = mount()
    const chip = stage.querySelector<HTMLElement>('[role="toolbar"] span.bg-solid')!
    const before = chip.style.left

    press("ToolImage")

    expect(all.onInsertImage).toHaveBeenCalledOnce()
    expect(all.onTool).not.toHaveBeenCalled()
    expect(button("ToolImage").getAttribute("aria-pressed")).toBe("false")
    expect(chip.style.left).toBe(before)
  })

  it("leaves keys aimed outside the map alone, so a menu over the page keeps its Escape", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })
    const menu = document.createElement("div")
    document.body.appendChild(menu)

    key({ key: "4" }, menu)
    key({ key: "Escape" }, menu)

    expect(all.onShape).not.toHaveBeenCalled()
    expect(isOpen("ToolShape")).toBe(true)
    menu.remove()
  })

  it("stands its keys down while the ring owns the keyboard", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape", keysSuspended: true })

    key({ key: "Escape" })

    expect(isOpen("ToolShape")).toBe(true)
  })

  it("hands the focus back to the tool when its shelf closes around it", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })
    const option = button("ShapeHexagon", shelf("ToolShape"))
    act(() => option.focus())

    key({ key: "Escape" }, option)

    expect(document.activeElement).toBe(button("ToolShape", stage.querySelector('[role="toolbar"]')!))
  })

  it("marks the tools that own a group, and whether it is open", () => {
    mount()

    for (const label of ["ToolPan", "ToolText", "ToolFrame", "ToolImage"]) {
      expect(button(label).getAttribute("aria-haspopup"), label).toBeNull()
    }
    expect(button("ToolShape").getAttribute("aria-expanded")).toBe("false")
    press("ToolShape")
    expect(button("ToolShape").getAttribute("aria-expanded")).toBe("true")
    expect(button("ToolSelect").getAttribute("aria-haspopup")).toBe("true")
  })

  it("arms select from another tool without opening its group", () => {
    const all = mount({ tool: "node" })

    press("ToolSelect")

    expect(all.onTool).toHaveBeenCalledWith("select")
    expect(button("ToolSelect").getAttribute("aria-expanded")).toBe("false")
  })

  it("opens the select group inside the bar, pushing the tools after it along", () => {
    const all = mount()
    const bar = stage.querySelector<HTMLElement>('[role="toolbar"]')!
    const resting = parseFloat(bar.style.width)

    press("ToolSelect")

    const tray = bar.querySelector('[role="group"][aria-label="ToolSelect"]')!
    expect(tray.hasAttribute("inert")).toBe(false)
    expect(tray.querySelectorAll("button")).toHaveLength(2)
    expect(button("ToolSelectBox", tray)).toBeTruthy()
    expect(parseFloat(bar.style.width)).toBeGreaterThan(resting)
    expect(all.onTool).not.toHaveBeenCalled()
  })

  it("says under the connect tool's name what a connect writes", () => {
    mount()
    const tool = button("ToolConnect")
    expect(tool.dataset.tooltip).toBe("ToolConnect")
    expect(tool.dataset.tooltipDetail).toBe("ToolConnectDetail")
  })

  it("names the select mode and its key on the tool, and the key of each mode in its group", () => {
    const bound = (actionId: string, chord: string) =>
      ({ actionId, bindings: [{ kind: "Chord", chord }] }) as Partial<Keybind> as Keybind
    useKeybindStore.getState().setKeybinds([bound("mindmap.tool-select", "V"), bound("mindmap.tool-lasso", "L")])
    try {
      const all = mount({ selectMode: "lasso" })
      const tool = button("ToolSelect")
      expect(tool.dataset.tooltip).toBe("ToolLasso")
      expect(tool.dataset.tooltipChord).toBe("L")

      rerender(all, { selectMode: "box" })
      expect(tool.dataset.tooltip).toBe("ToolSelectBox")
      expect(tool.dataset.tooltipChord).toBe("V")
      const tray = stage.querySelector('[role="group"][aria-label="ToolSelect"]')!
      expect(button("ToolSelectBox", tray).getAttribute("aria-keyshortcuts")).toBe("V")
      expect(button("ToolLasso", tray).getAttribute("aria-keyshortcuts")).toBe("L")
    } finally {
      useKeybindStore.getState().setKeybinds([])
    }
  })

  it("presses a tool for the map's keys just as a click does", () => {
    const commands = createRef<ToolbarCommands>() as { current: ToolbarCommands | null }
    const all = mount({ commands })

    act(() => commands.current!.press("shape"))
    expect(all.onTool).toHaveBeenCalledWith("shape")
    expect(isOpen("ToolShape")).toBe(true)

    rerender(all, { tool: "shape" })
    act(() => commands.current!.press("shape"))
    expect(isOpen("ToolShape")).toBe(false)
  })

  it("moves the focus onto the bar, and Escape there hands it back to the map", () => {
    const commands = createRef<ToolbarCommands>() as { current: ToolbarCommands | null }
    mount({ commands })
    const canvas = document.createElement("div")
    canvas.tabIndex = 0
    canvas.dataset.mmCanvas = ""
    stage.append(canvas)

    act(() => commands.current!.focus())
    const focused = document.activeElement as HTMLElement
    expect(focused.dataset.tbTool).toBe("select")

    key({ key: "Escape" }, focused)
    expect(document.activeElement).toBe(canvas)
  })

  it("hands the focus to the armed tool when another tool closes a group under it", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })
    const option = button("ShapeEllipse", shelf("ToolShape"))
    act(() => option.focus())

    rerender(all, { tool: "pan" })

    expect(isOpen("ToolShape")).toBe(false)
    expect(document.activeElement).toBe(button("ToolPan"))
  })

  it("brings the focus back from the page when the browser has already let go of it", () => {
    const all = mount()
    press("ToolShape")
    rerender(all, { tool: "shape" })
    const option = button("ShapeEllipse", shelf("ToolShape"))
    act(() => option.focus())
    act(() => option.blur())

    rerender(all, { tool: "pan" })

    expect(document.activeElement).toBe(button("ToolPan"))
  })

  it("wears the lasso while the select tool is set to it", () => {
    mount({ selectMode: "lasso" })

    const tray = stage.querySelector('[role="group"][aria-label="ToolSelect"]')!
    expect(button("ToolLasso", tray).getAttribute("aria-pressed")).toBe("true")
    const tool = stage.querySelector('[role="toolbar"] [data-tb-tool][aria-label="ToolSelect"]')!
    expect(tool.querySelector(".lucide-lasso")).not.toBeNull()
  })

  it("wears the shape it will plant", () => {
    mount({ shape: "hexagon" })

    expect(button("ToolShape").querySelector("svg[data-shape]")?.getAttribute("data-shape")).toBe("hexagon")
  })

  it("is a toolbar that says which way it runs", () => {
    mount({ edge: "left" })

    const bar = stage.querySelector('[role="toolbar"]')!
    expect(bar.getAttribute("aria-orientation")).toBe("vertical")
  })

  it("moves the dock to the edge an arrow points at from the grip", () => {
    const all = mount()

    key({ key: "ArrowLeft" }, button("ToolbarMove"))

    expect(all.onEdge).toHaveBeenCalledWith("left")
  })

  it("carries the bar on a capture held by the pane, and docks where it is let go", () => {
    const all = mount()
    const capture = vi.fn()
    stage.setPointerCapture = capture

    pointer("pointerdown", button("ToolbarMove"), 600, 770)
    expect(capture).toHaveBeenCalledWith(1)
    pointer("pointermove", stage, 20, 400)
    expect(stage.querySelector('[role="toolbar"]')!.getAttribute("aria-orientation")).toBe("vertical")
    expect(stage.textContent).toContain("ToolbarReleaseLeft")

    pointer("lostpointercapture", stage, 20, 400)

    expect(all.onEdge).toHaveBeenCalledWith("left")
  })

  it("leaves the bar where it is on a plain click of the grip", () => {
    const all = mount()

    pointer("pointerdown", button("ToolbarMove"), 600, 770)
    pointer("pointermove", stage, 601, 771)
    pointer("pointerup", stage, 601, 771)

    expect(all.onEdge).not.toHaveBeenCalled()
    expect(stage.textContent).not.toContain("ToolbarRelease")
  })

  it("puts the bar back where it was when the carry is cancelled", () => {
    const all = mount()

    pointer("pointerdown", button("ToolbarMove"), 600, 770)
    pointer("pointermove", stage, 20, 400)
    pointer("pointercancel", stage, 20, 400)

    expect(all.onEdge).not.toHaveBeenCalled()
    expect(stage.querySelector('[role="toolbar"]')!.getAttribute("aria-orientation")).toBe("horizontal")
  })
})

function pointer(type: string, target: EventTarget, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperty(event, "pointerId", { value: 1 })
  act(() => void target.dispatchEvent(event))
}
