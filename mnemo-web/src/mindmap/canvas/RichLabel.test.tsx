// @vitest-environment jsdom

/**
 * A formatted label on the canvas: it draws its runs as marked-up DOM, it keeps the chrome a plain
 * label gets, and it is the same box the measurer laid the runs out in.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { defaultTextStyle, type InlineSpan, type TextStyle } from "@/notes/model/types"

import type { SceneElement } from "../model/scene"
import { FONTS, lineHeightOf, richMeasurer } from "../scene/measure"
import { RICH_BOX_CLASS, richBoxStyle } from "../scene/rich-box"
import { MindmapNode } from "./MindmapNode"
import { renderRuns } from "./render-runs"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const text = (value: string, style: Partial<TextStyle> = {}): InlineSpan => ({
  kind: "text",
  text: value,
  style: { ...defaultTextStyle, ...style },
})

const RUNS: InlineSpan[] = [text("Hello "), text("world", { bold: true })]

function node(over: Partial<SceneElement> = {}): SceneElement {
  return {
    id: "a",
    kind: "node",
    content: { $type: "text", text: "Hello world", runs: RUNS },
    x: 0,
    y: 0,
    width: 120,
    height: 40,
    depth: 1,
    branch: 0,
    nodeShape: "card",
    text: { lines: ["Hello world"], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: false,
    childCount: 0,
    hiddenCount: 0,
    ...over,
  }
}

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

const label = (): HTMLElement => container.querySelector<HTMLElement>(".mm-rich")!

const { openExternally } = vi.hoisted(() => ({ openExternally: vi.fn() }))
vi.mock("@/lib/external", () => ({ openExternally }))

describe("a link in a drawn label", () => {
  const linked = (): SceneElement =>
    node({ content: { $type: "text", text: "see docs", runs: [text("see "), text("docs", { linkUrl: "https://x.test/" })] } })

  it("never follows its address on a click, since the window has no way back", () => {
    act(() => root.render(<MindmapNode element={linked()} />))
    const anchor = label().querySelector("a[href]")!
    const click = new MouseEvent("click", { bubbles: true, cancelable: true })
    act(() => {
      anchor.dispatchEvent(click)
    })
    expect(click.defaultPrevented).toBe(true)
    expect(openExternally).not.toHaveBeenCalled()
    expect(anchor.getAttribute("draggable")).toBe("false")
  })

  it("opens in the system browser with the modifier, the way a link in a note does", () => {
    act(() => root.render(<MindmapNode element={linked()} />))
    const anchor = label().querySelector("a[href]")!
    act(() => {
      anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }))
    })
    expect(openExternally).toHaveBeenCalledWith("https://x.test/")
  })
})

describe("a formatted label", () => {
  it("draws its runs as marked-up DOM rather than as its plain lines", () => {
    act(() => root.render(<MindmapNode element={node()} />))

    expect(label().innerHTML).toBe("Hello <strong>world</strong>")
    expect(container.querySelector(".whitespace-pre")).toBeNull()
  })

  it("redraws when the runs change and not otherwise", () => {
    act(() => root.render(<MindmapNode element={node()} />))
    const before = label().querySelector("strong")!

    act(() => root.render(<MindmapNode element={node({ textColor: "var(--ink-2)" })} />))
    expect(label().querySelector("strong")).toBe(before)

    const changed: InlineSpan[] = [text("Hello "), text("there", { italic: true })]
    act(() => root.render(<MindmapNode element={node({ content: { $type: "text", text: "Hello there", runs: changed } })} />))
    expect(label().innerHTML).toBe("Hello <em>there</em>")
  })

  it("draws an equation run as the notes atom, typeset", () => {
    const runs: InlineSpan[] = [text("area "), { kind: "equation", latex: "\\pi r^2", style: { ...defaultTextStyle } }]
    act(() => root.render(<MindmapNode element={node({ content: { $type: "text", text: "area \\pi r^2", runs } })} />))

    const atom = label().querySelector(".notes-equation")!
    expect(atom.getAttribute("aria-label")).toBe("\\pi r^2")
    expect(atom.querySelector(".katex")).not.toBeNull()
  })

  it("draws a legacy math row the same way, as one equation run", () => {
    act(() => root.render(<MindmapNode element={node({ content: { $type: "math", latex: "e^x" } })} />))

    expect(label().querySelector(".notes-equation")?.getAttribute("aria-label")).toBe("e^x")
  })

  it("carries the label class the scene index and the detail bands look for", () => {
    act(() => root.render(<MindmapNode element={node()} />))

    expect(label().classList.contains("mm-label")).toBe(true)
    expect(label().classList.contains("inline-marks")).toBe(true)
  })

  it("keeps a task's checkbox beside it and reads as done the way a plain label does", () => {
    act(() =>
      root.render(
        <MindmapNode element={node({ content: { $type: "task", text: "Hello world", runs: RUNS, done: true } })} />,
      ),
    )

    expect(container.querySelector('[data-mm-chrome="task"]')).not.toBeNull()
    expect(label().innerHTML).toBe("Hello <strong>world</strong>")
    expect(label().className).toContain("line-through")
    expect(label().className).toContain("text-ink-3")
  })

  it("sits at the label's own padding and inset, and takes the node's ink", () => {
    act(() => root.render(<MindmapNode element={node({ textColor: "var(--ink-2)" })} />))

    expect(label().style.paddingLeft).toBe("11px")
    expect(label().style.paddingRight).toBe("11px")
    expect(label().style.color).toBe("var(--ink-2)")
  })

  it("is centred on a root and on a shape, as a plain label is", () => {
    act(() => root.render(<MindmapNode element={node({ isRoot: true })} />))
    expect(label().className).toContain("text-center")

    act(() =>
      root.render(
        <MindmapNode
          element={node({ kind: "shape", content: { $type: "shape", shape: "rectangle", text: "Hello world", runs: RUNS } })}
        />,
      ),
    )
    expect(label().className).toContain("text-center")
  })
})

describe("the measurer's host and the label", () => {
  it("are the same box: one class list and one set of metrics", () => {
    const font = FONTS.m
    richMeasurer(renderRuns)(RUNS, font)
    const host = document.body.querySelector<HTMLElement>(":scope > span.mm-rich[aria-hidden]")!
    expect(host).not.toBeNull()

    act(() => root.render(<MindmapNode element={node()} />))
    const drawn = label()

    for (const name of RICH_BOX_CLASS.split(" ")) {
      expect(host.classList.contains(name)).toBe(true)
      expect(drawn.classList.contains(name)).toBe(true)
    }

    const shared = Object.keys(richBoxStyle({ font, lineHeight: lineHeightOf(font) })) as (keyof CSSStyleDeclaration)[]
    expect(shared.length).toBeGreaterThan(0)
    for (const key of shared) {
      expect(host.style[key], String(key)).toBe(drawn.style[key])
      expect(host.style[key], String(key)).not.toBe("")
    }
    expect(host.innerHTML).toBe(drawn.innerHTML)
  })

  it("wrap at the rung's ceiling and never at a fixed width", () => {
    richMeasurer(renderRuns)(RUNS, FONTS.l)
    const host = document.body.querySelector<HTMLElement>(":scope > span.mm-rich[aria-hidden]")!

    expect(host.style.maxWidth).toBe(`${FONTS.l.maxWidth}px`)
    expect(host.style.width).toBe("")
    expect(host.style.whiteSpace).toBe("pre-wrap")
  })
})
