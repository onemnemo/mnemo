// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useI18nStore } from "@/i18n/store"
import { useSettingsStore } from "@/settings/store"

import { ZOOM_STEP } from "../canvas/camera"
import type { Scene } from "../model/scene"
import { MindmapViewDock } from "./MindmapViewDock"

vi.mock("@/settings/api", () => ({ putSettingValue: vi.fn(async () => {}), fetchSettingValues: vi.fn() }))
vi.mock("@/nav/api", () => ({ fetchNav: vi.fn(async () => []) }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const KEY = "Mindmap.MinimapVisibility"
const SCENE: Scene = { id: "m", elements: [], edges: [], background: "dots" } as unknown as Scene

let container: HTMLElement
let root: Root

beforeEach(() => {
  // jsdom has no 2D context; the minimap draws nothing without one.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useSettingsStore.setState({ values: {} })
  useI18nStore.setState({ bundle: {} })
  vi.restoreAllMocks()
})

function mount(mode: string) {
  useSettingsStore.setState({ values: { [KEY]: mode } })
  const handlers = { onZoomBy: vi.fn(), onZoomReset: vi.fn(), onFit: vi.fn() }
  act(() =>
    root.render(
      <MindmapViewDock
        zoom={1.5}
        {...handlers}
        scene={SCENE}
        runtime={{ current: null }}
        pane={{ current: null }}
        sink={{ current: null }}
        selected={new Set()}
      />,
    ),
  )
  return handlers
}

const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const press = (label: string) => act(() => button(label).click())
const menu = () => container.querySelector<HTMLElement>('[role="dialog"]')!
const card = () => container.querySelector("canvas")!.closest<HTMLElement>("[aria-hidden]")!
const row = (text: string) =>
  [...menu().querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === text)!
const stored = () => useSettingsStore.getState().values[KEY]

describe("the view dock", () => {
  it("reads out the zoom", () => {
    mount("On")
    expect(button("Zoom").textContent).toContain("150%")
  })

  it("cycles the map button On, Auto, Off and back to On", () => {
    mount("On")
    press("MinimapState")
    expect(stored()).toBe("Auto")
    press("MinimapState")
    expect(stored()).toBe("Off")
    press("MinimapState")
    expect(stored()).toBe("On")
  })

  it("shows the map card when On and tucks it away when Off", () => {
    mount("On")
    expect(card().getAttribute("aria-hidden")).toBe("false")
    press("MinimapState")
    press("MinimapState")
    expect(card().getAttribute("aria-hidden")).toBe("true")
    expect(card().hasAttribute("inert")).toBe(true)
  })

  it("keeps the card away in Auto while the whole map is in view", () => {
    mount("Auto")
    expect(card().getAttribute("aria-hidden")).toBe("true")
  })

  it("opens the zoom menu from the percentage in the card's place", () => {
    mount("On")
    expect(menu().getAttribute("aria-hidden")).toBe("true")
    press("Zoom")
    expect(menu().getAttribute("aria-hidden")).toBe("false")
    expect(button("Zoom").getAttribute("aria-expanded")).toBe("true")
    expect(card().getAttribute("aria-hidden")).toBe("true")
    press("Zoom")
    expect(menu().getAttribute("aria-hidden")).toBe("true")
  })

  it("runs a row's command and closes", () => {
    const handlers = mount("On")
    const choose = (text: string) => {
      press("Zoom")
      act(() => row(text).click())
      expect(menu().getAttribute("aria-hidden")).toBe("true")
    }

    choose("ZoomIn")
    choose("ZoomOut")
    choose("ZoomTo100")
    choose("FitToScreenTooltip")

    expect(handlers.onZoomBy).toHaveBeenNthCalledWith(1, ZOOM_STEP)
    expect(handlers.onZoomBy).toHaveBeenNthCalledWith(2, 1 / ZOOM_STEP)
    expect(handlers.onZoomReset).toHaveBeenCalledOnce()
    expect(handlers.onFit).toHaveBeenCalledOnce()
  })

  it("writes the same setting from the switch in the menu", () => {
    mount("On")
    press("Zoom")
    act(() => menu().querySelector<HTMLButtonElement>('[role="radio"][aria-label="MinimapOff"]')!.click())
    expect(stored()).toBe("Off")
    expect(menu().getAttribute("aria-hidden")).toBe("false")
  })

  it("closes on Escape without letting the map hear it", () => {
    mount("On")
    press("Zoom")
    const heard = vi.fn()
    document.addEventListener("keydown", heard)
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    document.removeEventListener("keydown", heard)
    expect(menu().getAttribute("aria-hidden")).toBe("true")
    expect(heard).not.toHaveBeenCalled()
  })

  it("closes on a press outside the dock, and not on one inside it", () => {
    mount("On")
    press("Zoom")
    act(() => {
      menu().dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })
    expect(menu().getAttribute("aria-hidden")).toBe("false")
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    })
    expect(menu().getAttribute("aria-hidden")).toBe("true")
  })

  it("names the map button by its state and the next one", () => {
    useI18nStore.setState({
      bundle: {
        Mindmap: {
          MinimapState: "Minimap: {0}",
          MinimapNext: "Click for {0}",
          MinimapOn: "On",
          MinimapAuto: "Auto",
          MinimapOff: "Off",
        },
      },
    })
    mount("On")
    const map = button("Minimap: On")
    expect(map.dataset.tooltipDetail).toBe("Click for Auto")
    expect(map.dataset.tooltipSide).toBe("left")
    act(() => map.click())
    expect(button("Minimap: Auto").dataset.tooltipDetail).toBe("Click for Off")
  })

  it("reserves the card's height for the toolbar except when Off, and not more for the menu", () => {
    mount("Auto")
    const dock = container.firstElementChild as HTMLElement
    expect(dock.style.height).toBe("178px")
    press("Zoom")
    expect(dock.style.height).toBe("178px")
    act(() => menu().querySelector<HTMLButtonElement>('[role="radio"][aria-label="MinimapOff"]')!.click())
    expect(dock.style.height).toBe("40px")
  })

  it("hands the focus back to the percentage when the menu closes around it", () => {
    mount("On")
    press("Zoom")
    act(() => row("ZoomTo100").focus())
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(document.activeElement).toBe(button("Zoom"))
  })

  it("leaves Escape to a field being typed into", () => {
    mount("On")
    press("Zoom")
    const field = document.createElement("input")
    document.body.appendChild(field)
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    field.remove()
    expect(menu().getAttribute("aria-hidden")).toBe("false")
  })

  it("feeds every camera change to the Auto rule", () => {
    useSettingsStore.setState({ values: { [KEY]: "Auto" } })
    const sink: { current: ((viewport: { x: number; y: number; zoom: number }) => void) | null } = { current: null }
    const pane = document.createElement("div")
    Object.defineProperties(pane, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
    const scene = {
      ...SCENE,
      elements: [{ id: "n", kind: "node", x: 0, y: 0, width: 400, height: 300 }],
    } as unknown as Scene
    act(() =>
      root.render(
        <MindmapViewDock
          zoom={1}
          onZoomBy={vi.fn()}
          onZoomReset={vi.fn()}
          onFit={vi.fn()}
          scene={scene}
          runtime={{ current: null }}
          pane={{ current: pane }}
          sink={sink}
          selected={new Set()}
        />,
      ),
    )

    act(() => sink.current?.({ x: 200, y: 0, zoom: 1 }))
    expect(card().getAttribute("aria-hidden")).toBe("false")
    act(() => sink.current?.({ x: -100, y: -100, zoom: 1 }))
    expect(card().getAttribute("aria-hidden")).toBe("true")
  })
})
