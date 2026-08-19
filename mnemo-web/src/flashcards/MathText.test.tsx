// @vitest-environment jsdom

/**
 * Mounts the real component rather than testing `split`/`render` in isolation, because the
 * short-circuit for plain text and the error fallback both live in the component body, not in
 * `math.ts`.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MathText } from "./MathText"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(children: string) {
  act(() => {
    root.render(<MathText>{children}</MathText>)
  })
}

describe("MathText", () => {
  it("renders plain text unchanged when there is no dollar sign", () => {
    render("no formulas here")
    expect(container.textContent).toBe("no formulas here")
    expect(container.querySelector(".katex")).toBeNull()
  })

  it("renders inline maths as KaTeX HTML, not the raw source", () => {
    render("the charge is $q$ coulombs")
    expect(container.querySelector(".katex")).not.toBeNull()
    expect(container.textContent).not.toContain("$q$")
  })

  it("renders display maths in a block wrapper", () => {
    render("$$E = mc^2$$")
    const wrapper = container.querySelector(".block")
    expect(wrapper).not.toBeNull()
    expect(wrapper?.querySelector(".katex")).not.toBeNull()
  })

  it("shows an unparseable formula as its own typed source, marked, not KaTeX's inline error", () => {
    // An unterminated \frac is a KaTeX ParseError: throwOnError is on, so this must fall
    // through to the catch branch rather than emit KaTeX's own red error span.
    render("broken: $\\frac{1}{$ end")
    expect(container.querySelector(".katex")).toBeNull()
    expect(container.textContent).toContain("$\\frac{1}{$")
    const marked = container.querySelector("[title]")
    expect(marked?.getAttribute("title")).toBe("StudyMathUnreadable")
  })

  it("keeps adjacent literal and maths regions distinct", () => {
    render("before $a$ middle $b$ after")
    expect(container.querySelectorAll(".katex").length).toBe(2)
    expect(container.textContent).toContain("before")
    expect(container.textContent).toContain("middle")
    expect(container.textContent).toContain("after")
  })
})
