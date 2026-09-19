// @vitest-environment jsdom

/**
 * The DOM a run list is drawn as: every mark as the element the notes schema renders it as, nested
 * in the schema's rank order, the atoms as the notes atoms, and a link that only carries an address
 * the notes rule would let through.
 */

import { describe, expect, it, vi } from "vitest"

import { defaultTextStyle, type InlineSpan, type TextStyle } from "@/notes/model/types"

vi.mock("@/notes/editor/atoms/katex", () => ({
  renderMath: vi.fn((host: HTMLElement, source: string, label: string) => {
    host.setAttribute("role", "math")
    host.setAttribute("aria-label", label)
    host.textContent = `[${source}]`
  }),
}))

import { renderRuns } from "./render-runs"

const text = (value: string, style: Partial<TextStyle> = {}): InlineSpan => ({
  kind: "text",
  text: value,
  style: { ...defaultTextStyle, ...style },
})

function draw(runs: InlineSpan[]): HTMLElement {
  const host = document.createElement("span")
  renderRuns(host, runs)
  return host
}

describe("each mark", () => {
  it.each([
    ["bold", { bold: true }, "strong"],
    ["italic", { italic: true }, "em"],
    ["underline", { underline: true }, "u"],
    ["strikethrough", { strikethrough: true }, "s"],
    ["code", { code: true }, "code"],
    ["highlight", { highlight: true }, "mark"],
    ["subscript", { subscript: true }, "sub"],
    ["superscript", { superscript: true }, "sup"],
  ] as const)("draws %s as the element the notes schema renders it as", (_name, style, tag) => {
    const host = draw([text("a", style)])
    expect(host.innerHTML).toBe(`<${tag}>a</${tag}>`)
  })

  it("draws a colour and a background as the swatch spans the stylesheet paints", () => {
    expect(draw([text("a", { foregroundColor: "swatch4" })]).innerHTML).toBe('<span data-fg-swatch="swatch4">a</span>')
    expect(draw([text("a", { backgroundColor: "swatch2" })]).innerHTML).toBe('<span data-bg-swatch="swatch2">a</span>')
  })

  it("draws a link as an anchor with the address", () => {
    expect(draw([text("a", { linkUrl: "https://example.com" })]).innerHTML).toBe(
      '<a href="https://example.com" rel="noopener noreferrer" draggable="false">a</a>',
    )
  })

  it("gives an unsafe address no href at all, the notes rule", () => {
    const host = draw([text("a", { linkUrl: "javascript:alert(1)" })])
    const anchor = host.querySelector("a")!
    expect(anchor.hasAttribute("href")).toBe(false)
    expect(anchor.textContent).toBe("a")
  })

  it("draws plain text as a bare text node", () => {
    const host = draw([text("plain")])
    expect(host.childNodes).toHaveLength(1)
    expect(host.firstChild!.nodeType).toBe(Node.TEXT_NODE)
  })
})

describe("marks together", () => {
  it("nest in the order the notes schema ranks them, outermost first", () => {
    const host = draw([
      text("a", {
        bold: true,
        italic: true,
        subscript: true,
        superscript: true,
        underline: true,
        strikethrough: true,
        code: true,
        highlight: true,
        backgroundColor: "swatch1",
        foregroundColor: "swatch2",
        linkUrl: "https://x",
      }),
    ])
    expect(host.innerHTML).toBe(
      "<strong><em><sub><sup><u><s><code><mark>" +
        '<span data-bg-swatch="swatch1"><span data-fg-swatch="swatch2"><a href="https://x" rel="noopener noreferrer" draggable="false">a</a></span></span>' +
        "</mark></code></s></u></sup></sub></em></strong>",
    )
  })

  it("draws one run after another as siblings", () => {
    const host = draw([text("a "), text("b", { bold: true }), text(" c")])
    expect(host.innerHTML).toBe("a <strong>b</strong> c")
  })
})

describe("a break and the atoms", () => {
  it("keeps a newline inside a run as a character, for the box's pre-wrap to break at", () => {
    const host = draw([text("one\ntwo")])
    expect(host.textContent).toBe("one\ntwo")
    expect(host.querySelector("br")).toBeNull()
  })

  it("draws an equation as the notes equation atom, typeset from its source", () => {
    const host = draw([{ kind: "equation", latex: "x^2", style: { ...defaultTextStyle } }])
    const atom = host.querySelector("span.notes-atom.notes-equation")!
    expect(atom).not.toBeNull()
    expect(atom.getAttribute("aria-label")).toBe("x^2")
    expect(atom.textContent).toBe("[x^2]")
  })

  it("draws a fraction as the notes fraction atom, read as n over d", () => {
    const host = draw([{ kind: "fraction", numerator: 3, denominator: 4, style: { ...defaultTextStyle } }])
    const atom = host.querySelector("span.notes-atom.notes-fraction")!
    expect(atom.getAttribute("aria-label")).toBe("3/4")
    expect(atom.textContent).toBe("[\\frac{3}{4}]")
  })

  it("wraps an atom in its marks like any run", () => {
    const host = draw([{ kind: "equation", latex: "x", style: { ...defaultTextStyle, bold: true } }])
    expect(host.firstElementChild!.tagName).toBe("STRONG")
    expect(host.querySelector("strong > .notes-equation")).not.toBeNull()
  })

  it("replaces what was in the host, so a redraw does not stack", () => {
    const host = draw([text("first")])
    renderRuns(host, [text("second")])
    expect(host.textContent).toBe("second")
  })
})
