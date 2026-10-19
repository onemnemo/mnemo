// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it } from "vitest"

import { useCheckboxDrag } from "./useCheckboxDrag"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const IDS = ["a", "b", "c", "d", "e", "f"]

let container: HTMLElement
let root: Root
let selected: ReadonlySet<string>

function Rows({ initial }: { initial: readonly string[] }) {
  const [state, setState] = useState<ReadonlySet<string>>(() => new Set(initial))
  selected = state
  const start = useCheckboxDrag(IDS, state, setState)
  return (
    <div onPointerDown={start}>
      {IDS.map((id) => (
        <div key={id} data-card-id={id}>
          <span data-row-check>
            <button type="button" />
          </span>
        </div>
      ))}
    </div>
  )
}

const sorted = () => [...selected].sort()

/** jsdom has no layout, so the row under the pointer is looked up by its y as an index. */
function underPointer() {
  document.elementFromPoint = (_x: number, y: number) => container.querySelectorAll("[data-card-id]")[y] ?? null
}

function press(index: number, init: PointerEventInit = {}) {
  const box = container.querySelectorAll("[data-row-check] button")[index]
  act(() => box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientY: index, ...init })))
}

function moveTo(index: number) {
  act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: index })))
}

function release() {
  act(() => window.dispatchEvent(new PointerEvent("pointerup")))
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  underPointer()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it("selects every row a drag passes from an empty box, the first included", () => {
  act(() => root.render(<Rows initial={[]} />))
  press(0)
  moveTo(3)
  release()
  expect(sorted()).toEqual(["a", "b", "c", "d"])
})

it("clears every row a drag passes from a checked box", () => {
  act(() => root.render(<Rows initial={IDS} />))
  press(3)
  moveTo(1)
  release()
  expect(sorted()).toEqual(["a", "e", "f"])
})

it("puts rows the drag backs out of back the way they were", () => {
  act(() => root.render(<Rows initial={["e"]} />))
  press(0)
  moveTo(5)
  moveTo(2)
  release()
  expect(sorted()).toEqual(["a", "b", "c", "e"])
})

it("restores the whole selection when Escape cancels the drag", () => {
  act(() => root.render(<Rows initial={["b"]} />))
  press(0)
  moveTo(4)
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
  release()
  expect(sorted()).toEqual(["b"])
})

it("sets the range from the last box pressed on a shift press, the way the pressed box switches", () => {
  act(() => root.render(<Rows initial={[]} />))
  press(1)
  release()
  act(() => root.render(<Rows initial={[]} />))
  press(4, { shiftKey: true })
  expect(sorted()).toEqual(["b", "c", "d", "e"])
})

it("keeps a held shift press from being toggled back by the click on release", async () => {
  act(() => root.render(<Rows initial={[]} />))
  press(1)
  release()
  press(4, { shiftKey: true })
  // A real press is held for a while. The click comes with the release.
  await new Promise((resolve) => setTimeout(resolve, 20))
  const box = container.querySelectorAll("[data-row-check] button")[4]
  let reached = false
  box.addEventListener("click", () => (reached = true))
  release()
  act(() => box.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  expect(reached).toBe(false)
})

it("keeps a held press cancelled by Escape from being toggled by the click on release", async () => {
  act(() => root.render(<Rows initial={["b"]} />))
  press(0)
  moveTo(3)
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
  await new Promise((resolve) => setTimeout(resolve, 20))
  const box = container.querySelectorAll("[data-row-check] button")[3]
  let reached = false
  box.addEventListener("click", () => (reached = true))
  release()
  act(() => box.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  expect(reached).toBe(false)
  expect(sorted()).toEqual(["b"])
})

it("lets a later click through when the press Escape cancelled ends in a pointer cancel", async () => {
  act(() => root.render(<Rows initial={[]} />))
  press(0)
  moveTo(3)
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
  act(() => window.dispatchEvent(new PointerEvent("pointercancel")))
  await new Promise((resolve) => setTimeout(resolve, 20))
  const box = container.querySelectorAll("[data-row-check] button")[2]
  let reached = false
  box.addEventListener("click", () => (reached = true))
  release()
  act(() => box.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  expect(reached).toBe(true)
})

it("leaves a press that never leaves its box to the checkbox's own click", () => {
  act(() => root.render(<Rows initial={[]} />))
  press(2)
  moveTo(2)
  const box = container.querySelectorAll("[data-row-check] button")[2]
  let reached = false
  box.addEventListener("click", () => (reached = true))
  release()
  act(() => box.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  expect(reached).toBe(true)
  expect([...selected]).toEqual([])
})

it("scrolls the list along while the drag sits near its bottom edge", async () => {
  // A 100px tall scroller over a taller list, with the pointer 5px above its bottom.
  container.style.overflowY = "auto"
  let scrollTop = 0
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 100 },
    scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => (scrollTop = value) },
  })
  container.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect
  act(() => root.render(<Rows initial={[]} />))
  press(0)
  moveTo(1)
  moveTo(95)
  await new Promise((resolve) => setTimeout(resolve, 100))
  release()
  expect(scrollTop).toBeGreaterThan(0)
})
