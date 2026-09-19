// @vitest-environment jsdom

/**
 * The field a node opens as: the notes editor for a label that is its own to format, the textarea
 * for source and for a title, and the textarea standing in for the editor until its chunk arrives.
 * Under StrictMode, whose deliberate mount, unmount and mount again is exactly the teardown this
 * has to survive: an editor left behind would be a second toolbar on the page.
 *
 * The first test renders before the chunk has been awaited, which is the only moment the stand-in
 * can be seen in this file; every test after it finds the chunk already in memory.
 */

import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { resetShutdownForTests } from "@/app/shutdown"
import { defaultTextStyle, type InlineSpan } from "@/notes/model/types"

import { cameraSignal } from "./camera-signal"
import { loadLabelEditor } from "./label-editor-chunk"
import { measureFor } from "./live-box"
import { MindmapNode } from "./MindmapNode"
import { plainRuns } from "../model/runs"
import type { ElementContent } from "../model/document"
import type { SceneElement } from "../model/scene"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const text = (value: string, style: Partial<InlineSpan["style"]> = {}): InlineSpan => ({
  kind: "text",
  text: value,
  style: { ...defaultTextStyle, ...style },
})

function node(content: ElementContent, over: Partial<SceneElement> = {}): SceneElement {
  return {
    id: "a",
    kind: "node",
    content,
    x: 0,
    y: 0,
    width: 120,
    height: 40,
    depth: 1,
    branch: 0,
    nodeShape: "card",
    text: { lines: ["hello"], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: false,
    childCount: 0,
    hiddenCount: 0,
    ...over,
  }
}

/** A node whose box is exactly what its own label measures to, which is how the projector makes one. */
function autoNode(content: ElementContent): SceneElement {
  const seed = node(content)
  const measured = measureFor(seed, { text: "hello" })
  return node(content, { width: measured.width, height: measured.height })
}

beforeAll(() => {
  ;(document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    // no layout to scroll
  }
})

let container: HTMLElement
let root: Root
let disposed: boolean

beforeEach(() => {
  resetShutdownForTests()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  disposed = false
})

function dispose(): void {
  if (disposed) return
  disposed = true
  act(() => root.unmount())
}

afterEach(() => {
  dispose()
  container.remove()
  document.body.replaceChildren()
})

const editors = () => document.querySelectorAll(".ProseMirror")
const toolbars = () => document.querySelectorAll(".notes-formatting-toolbar")
const editorDom = () => container.querySelector<HTMLElement>(".ProseMirror")!

function key(target: Element, name: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }))
  })
}

function type(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!
  act(() => {
    setter.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("before the editor chunk is here", () => {
  it("shows the textarea, carries what was typed into the editor, and finishes with it as one run", async () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={node({ $type: "text", text: "hello" })} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("textarea")!
    expect(field).not.toBeNull()
    expect(editors()).toHaveLength(0)
    type(field, "typed")

    await act(async () => {
      await loadLabelEditor()
    })

    expect(container.querySelector("textarea")).toBeNull()
    expect(editors()).toHaveLength(1)
    expect(editorDom().textContent).toBe("typed")

    key(editorDom(), "Enter")
    expect(onEditEnd).toHaveBeenCalledWith("a", { runs: plainRuns("typed") })
    // The chunk is the whole notes editor, and its first load in a fresh worker is a compile.
  }, 60_000)
})

describe("a label that is its own to format", () => {
  it("opens one editor and one toolbar under StrictMode, and takes both away on unmount", async () => {
    const onEditEnd = vi.fn()
    await act(async () => {
      root.render(
        <StrictMode>
          <MindmapNode element={node({ $type: "text", text: "hello" })} editing onEditEnd={onEditEnd} />
        </StrictMode>,
      )
    })

    expect(editors()).toHaveLength(1)
    expect(toolbars()).toHaveLength(1)
    expect(container.querySelector("[data-mm-editor]")).not.toBeNull()
    expect(onEditEnd).not.toHaveBeenCalled()

    await act(async () => dispose())

    expect(editors()).toHaveLength(0)
    expect(toolbars()).toHaveLength(0)
    expect(onEditEnd).toHaveBeenCalledWith("a", { runs: [text("hello")] })
  })

  it("opens on the runs a formatted label holds, and finishes with them", async () => {
    const onEditEnd = vi.fn()
    const runs = [text("hel"), text("lo", { bold: true })]
    await act(async () => {
      root.render(<MindmapNode element={node({ $type: "text", text: "hello", runs })} editing onEditEnd={onEditEnd} />)
    })

    expect(editorDom().querySelector("strong")?.textContent).toBe("lo")
    key(editorDom(), "Enter")
    expect(onEditEnd).toHaveBeenCalledWith("a", { runs })
  })

  it("abandons with null on Escape", async () => {
    const onEditEnd = vi.fn()
    await act(async () => {
      root.render(<MindmapNode element={node({ $type: "text", text: "hello" })} editing onEditEnd={onEditEnd} />)
    })
    key(editorDom(), "Escape")
    expect(onEditEnd).toHaveBeenCalledWith("a", null)
  })

  it("carries the label's metrics and the attribute the controller leaves alone", async () => {
    const element = node({ $type: "text", text: "hello" }, { isRoot: true, textColor: "var(--ink)" })
    await act(async () => {
      root.render(<MindmapNode element={element} editing onEditEnd={vi.fn()} />)
    })
    const mount = container.querySelector<HTMLElement>("[data-mm-editor]")!
    expect(mount.className).toContain("mm-editor")
    expect(mount.className).toContain("inline-marks")
    expect(mount.className).toContain("select-text")
    expect(mount.style.fontSize).toBe("14px")
    expect(mount.style.fontWeight).toBe("500")
    expect(mount.style.lineHeight).toBe("19px")
    expect(mount.style.letterSpacing).toBe("-0.005em")
    expect(mount.style.paddingLeft).toBe("11px")
    expect(mount.style.textAlign).toBe("center")
    expect(mount.style.maxWidth).not.toBe("")
  })

  it("sizes the box from the measurement of what the field holds, so the commit lands on it", async () => {
    const element = autoNode({ $type: "text", text: "hello" })
    const onEditResize = vi.fn()
    await act(async () => {
      root.render(<MindmapNode element={element} editing onEditEnd={vi.fn()} onEditResize={onEditResize} />)
    })
    const mount = container.querySelector<HTMLElement>("[data-mm-editor]")!
    // The field's own height is not what a formatted label is sized by: the measurer renders the
    // same runs into the same box, so its answer is the one the commit will land on.
    Object.defineProperty(mount, "scrollHeight", { configurable: true, get: () => 999 })
    onEditResize.mockClear()

    // The label opens selected whole, so the break replaces it: the box is now a blank line's.
    key(editorDom(), "Enter", { shiftKey: true })

    const expected = measureFor(element, { text: "\n", runs: plainRuns("\n") })
    const box = container.querySelector<HTMLElement>(".mm-node")!
    expect(box.style.height).toBe(`${expected.height}px`)
    expect(box.style.height).not.toBe(`${999 + element.padding.y * 2}px`)
    expect(onEditResize).toHaveBeenCalledWith("a", {
      x: element.x,
      y: element.y,
      width: expected.width,
      height: expected.height,
    })
  })

  it("hears the camera, so the chrome anchored to the caret follows a pan", async () => {
    await act(async () => {
      root.render(<MindmapNode element={node({ $type: "text", text: "hello" })} editing onEditEnd={vi.fn()} />)
    })
    const scrolled = vi.fn()
    editorDom().addEventListener("scroll", scrolled)
    act(() => cameraSignal.emit())
    expect(scrolled).toHaveBeenCalledTimes(1)
  })
})

describe("a field that stays plain", () => {
  it("edits a code node's source in the textarea and finishes with its text", async () => {
    const onEditEnd = vi.fn()
    await act(async () => {
      root.render(
        <MindmapNode
          element={node({ $type: "code", source: "let x = 1", language: "js" })}
          editing
          onEditEnd={onEditEnd}
        />,
      )
    })
    const field = container.querySelector("textarea")!
    expect(editors()).toHaveLength(0)
    expect(field.className).toContain("font-mono")

    key(field, "Enter")
    expect(onEditEnd).not.toHaveBeenCalled()
    key(field, "Enter", { ctrlKey: true })
    expect(onEditEnd).toHaveBeenCalledWith("a", { text: "let x = 1" })
  })

  it("edits a link's title in the textarea, since the title is the link's to keep plain", async () => {
    const onEditEnd = vi.fn()
    await act(async () => {
      root.render(
        <MindmapNode element={node({ $type: "link", url: "https://example.org", title: "Example" })} editing onEditEnd={onEditEnd} />,
      )
    })
    const field = container.querySelector("textarea")!
    expect(editors()).toHaveLength(0)
    key(field, "Enter")
    expect(onEditEnd).toHaveBeenCalledWith("a", { text: "Example" })
  })
})
