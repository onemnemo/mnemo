// @vitest-environment jsdom

import { act, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { cameraSignal } from "../canvas/camera-signal"
import type { MindmapEditor } from "../edit/useMindmapEditor"
import { EMPTY_SELECTION, selectOnly, type Selection } from "../interaction/selection"
import type { MindmapDocument } from "../model/document"
import type { MindmapOp } from "../model/ops"
import type { Scene } from "../model/scene"
import { estimateWidth, measurersFrom } from "../scene/measure"
import { projectScene } from "../scene/project"

import { imageMenuRows, useImageMenu } from "./useImageMenu"

vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DOCUMENT: MindmapDocument = {
  id: "m",
  elements: [
    { id: "slot", kind: "image", content: { $type: "canvasImage", assetId: "" }, x: 0, y: 0, width: 240, height: 160 },
    { id: "pic", kind: "image", content: { $type: "canvasImage", assetId: "a.png" }, x: 300, y: 0, width: 200, height: 100 },
    { id: "n", kind: "node", content: { $type: "text", text: "n" }, x: 0, y: 300, width: 80, height: 30 },
  ],
}

const SCENE: Scene = projectScene(DOCUMENT, { templates: [], defaultTemplateId: "", measurers: measurersFrom(estimateWidth) })

let container: HTMLElement
let root: Root
let applied: MindmapOp[][]
let picked: string[]
let selected: Selection
let menu: ReturnType<typeof useImageMenu>

const editor = {
  apply: vi.fn(async (ops: MindmapOp[]) => {
    applied.push(ops)
    return {}
  }),
} as unknown as MindmapEditor

function Harness({ selection }: { selection: Selection }) {
  const stage = useRef<HTMLDivElement>(null)
  menu = useImageMenu({
    stage,
    scene: SCENE,
    selection,
    setSelection: (next) => {
      selected = next
    },
    editor,
    pick: (id) => picked.push(id),
  })
  return (
    <div ref={stage} onContextMenu={menu.onContextMenu}>
      {SCENE.elements.map((element) => (
        <div key={element.id} className="mm-node" data-mm-id={element.id}>
          <span data-testid={element.id} />
          {element.id === "pic" ? <button type="button" data-mm-chrome="imageMenu" /> : null}
        </div>
      ))}
      {menu.menu}
    </div>
  )
}

function render(selection: Selection = EMPTY_SELECTION): void {
  act(() => root.render(<Harness selection={selection} />))
}

function rightClick(id: string): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })
  act(() => {
    container.querySelector(`[data-testid="${id}"]`)!.dispatchEvent(event)
  })
  return event
}

function items(): string[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? "")
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  applied = []
  picked = []
  selected = EMPTY_SELECTION
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("the rows an image offers", () => {
  it("offers the picture's actions on a filled image and only a way in or out on an empty one", () => {
    const ids = (filled: boolean) => imageMenuRows(filled).map((row) => (row === "separator" ? "-" : row.id))
    expect(ids(true)).toEqual(["replace", "crop", "-", "copy", "download", "-", "remove", "delete"])
    expect(ids(false)).toEqual(["choose", "-", "delete"])
  })
})

describe("the image menu", () => {
  it("opens on a right click, selecting the image first", () => {
    render()
    const event = rightClick("pic")

    expect(event.defaultPrevented).toBe(true)
    expect(selected).toEqual(selectOnly("element", "pic"))
    expect(items()).toEqual([
      "ImageReplace",
      "ImageCrop",
      "ImageCopy",
      "ImageDownload",
      "ImageRemove",
      "Delete",
    ])
  })

  it("offers Choose image on an empty image, which opens the picker", () => {
    render()
    rightClick("slot")
    expect(items()).toEqual(["ImageChoose", "Delete"])

    act(() => {
      ;(document.querySelector('[role="menuitem"]') as HTMLElement).click()
    })
    expect(picked).toEqual(["slot"])
  })

  it("opens from the options pill, selecting the picture and holding the pill up until it closes", () => {
    render()
    act(() => menu.openFromPill("pic"))
    const pic = container.querySelector<HTMLElement>('[data-mm-id="pic"]')!

    expect(selected).toEqual(selectOnly("element", "pic"))
    expect(items()).toContain("ImageCrop")
    expect(pic.hasAttribute("data-mm-menu")).toBe(true)

    act(() => cameraSignal.emit())
    expect(items()).toEqual([])
    expect(pic.hasAttribute("data-mm-menu")).toBe(false)
  })

  it("leaves a right click on anything else to the page", () => {
    render()
    const event = rightClick("n")

    expect(event.defaultPrevented).toBe(false)
    expect(items()).toEqual([])
  })

  it("opens on the one selected image for the menu key", () => {
    render(selectOnly("element", "pic"))
    let opened = false
    act(() => {
      opened = menu.openOnSelection()
    })

    expect(opened).toBe(true)
    expect(items()).toHaveLength(6)
  })

  it("opens on the selected image for a keyboard context menu on the canvas, not for a long press", () => {
    render(selectOnly("element", "pic"))
    const press = (pointerType: string | undefined) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0 })
      Object.defineProperty(event, "pointerType", { value: pointerType })
      act(() => {
        container.firstElementChild!.dispatchEvent(event)
      })
      return event
    }

    expect(press("touch").defaultPrevented).toBe(false)
    expect(press("pen").defaultPrevented).toBe(false)
    expect(menu.isOpen).toBe(false)

    expect(press(undefined).defaultPrevented).toBe(true)
    expect(menu.isOpen).toBe(true)
  })

  it("leaves a context menu on a control to the control", () => {
    render(selectOnly("element", "pic"))
    const button = document.createElement("button")
    container.firstElementChild!.append(button)
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0 })
    act(() => {
      button.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
    expect(menu.isOpen).toBe(false)
  })

  it("does not open for the menu key when the selection is not one image", () => {
    render(selectOnly("element", "n"))
    let opened = true
    act(() => {
      opened = menu.openOnSelection()
    })

    expect(opened).toBe(false)
    expect(menu.isOpen).toBe(false)
  })

  it("closes when the camera moves", () => {
    render()
    rightClick("pic")
    expect(menu.isOpen).toBe(true)

    act(() => cameraSignal.emit())
    expect(menu.isOpen).toBe(false)
  })

  it("turns a picture back into an empty image in one edit", async () => {
    render()
    rightClick("pic")
    const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "ImageRemove",
    )!
    await act(async () => {
      remove.click()
      await Promise.resolve()
    })

    expect(applied).toEqual([
      [
        { op: "set", id: "pic", content: { $type: "canvasImage", assetId: "" }, wh: [240, 160] },
        { op: "move", id: "pic", xy: [280, -30], pin: false },
      ],
    ])
  })
})
