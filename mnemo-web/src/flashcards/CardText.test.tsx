// @vitest-environment jsdom

/**
 * Mounts the real component rather than checking the parse in isolation, because the KaTeX
 * typesetting, its error fallback and the elements each marker turns into all live here rather
 * than in `card-format.ts`.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CardText } from "./CardText"

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
    root.render(<CardText>{children}</CardText>)
  })
}

describe("CardText maths", () => {
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

describe("CardText formatting", () => {
  it("renders each of the format bar's markers as its own element", () => {
    render("**b** *i* __u__ `c` ==h==")

    expect(container.querySelector("strong")?.textContent).toBe("b")
    expect(container.querySelector("em")?.textContent).toBe("i")
    expect(container.querySelector("u")?.textContent).toBe("u")
    expect(container.querySelector("code")?.textContent).toBe("c")
    expect(container.querySelector("mark")?.textContent).toBe("h")
    expect(container.textContent).not.toContain("*")
  })

  it("leaves an unpaired marker on screen as typed", () => {
    render("5 * 3 is 15")

    expect(container.querySelector("em")).toBeNull()
    expect(container.textContent).toBe("5 * 3 is 15")
  })

  it("typesets a formula inside a marker", () => {
    render("**$E=mc^2$**")

    const bold = container.querySelector("strong")
    expect(bold).not.toBeNull()
    expect(bold?.querySelector(".katex")).not.toBeNull()
  })

  it("renders a bulleted answer as a list with one item per line", () => {
    render("- one\n- two\n- three")

    const items = container.querySelectorAll("li")
    expect(items).toHaveLength(3)
    expect([...items].map((li) => li.textContent)).toEqual(["one", "two", "three"])
    expect(container.querySelectorAll("ul")).toHaveLength(1)
    expect(container.textContent).not.toContain("- ")
  })

  it("keeps multiline plain text in one paragraph, newlines and all", () => {
    render("first\nsecond\nthird")

    expect(container.querySelectorAll("p")).toHaveLength(1)
    expect(container.textContent).toBe("first\nsecond\nthird")
  })

  it("puts a list outside the paragraph rather than inside it", () => {
    render("Because:\n- one\n- two")

    expect(container.querySelector("p")?.textContent).toBe("Because:")
    expect(container.querySelector("p > ul")).toBeNull()
    expect(container.querySelectorAll("li")).toHaveLength(2)
  })
})
