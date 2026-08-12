/**
 * The emitter, driven by the real projector.
 *
 * A fixture scene written by hand would be a scene nothing else produces, so these go through
 * `projectScene` the way the canvas does: what is asserted here is what an export of that document
 * actually contains. Measurement is the estimator rather than a canvas, which is what lets the whole
 * thing run without a browser.
 */

import { describe, expect, it } from "vitest"

import type { MindmapDocument, MindmapEdge, MindmapElement, StyleTemplate } from "../model/document"
import { estimateWidth, measurersFrom } from "../scene/measure"
import { projectScene } from "../scene/project"
import { emitSvg, EXPORT_MARGIN, type SvgOptions } from "./svg"

const TEMPLATE: StyleTemplate = {
  id: "t",
  name: "T",
  rootStyle: { fill: "accent", textColor: "onAccent", nodeShape: "card", fontScale: "l" },
  depthRules: [{ minDepth: 1, style: { nodeShape: "card", fontScale: "m" } }],
  branchColors: "byBranch",
}

const node = (id: string, over: Partial<MindmapElement> = {}): MindmapElement => ({
  id,
  kind: "node",
  content: { $type: "text", text: id },
  ...over,
})

const edge = (from: string, to: string, over: Partial<MindmapEdge> = {}): MindmapEdge => ({
  id: `${from}-${to}`,
  fromId: from,
  toId: to,
  kind: "hierarchy",
  ...over,
})

const document = (over: Partial<MindmapDocument> = {}): MindmapDocument => ({
  id: "m",
  elements: [node("r"), node("a")],
  edges: [edge("r", "a")],
  ...over,
})

/** Every colour comes back as the same literal, so anything unflattened stands out in the markup. */
const options = (over: Partial<SvgOptions> = {}): SvgOptions => ({
  color: () => "#abcdef",
  measure: estimateWidth,
  measureMono: estimateWidth,
  background: "var(--canvas)",
  ...over,
})

function draw(doc: MindmapDocument, over: Partial<SvgOptions> = {}) {
  const scene = projectScene(doc, {
    templates: [TEMPLATE],
    defaultTemplateId: TEMPLATE.id,
    measurers: measurersFrom(estimateWidth),
  })
  return { scene, picture: emitSvg(scene, options(over)) }
}

describe("the picture", () => {
  it("is nothing at all for a map with nothing on it", () => {
    expect(emitSvg({ id: "m", elements: [], edges: [], background: "dots" }, options())).toBeNull()
  })

  it("holds the whole map with room around it", () => {
    const { scene, picture } = draw(document())

    const width = Math.max(...scene.elements.map((e) => e.x + e.width)) - Math.min(...scene.elements.map((e) => e.x))
    expect(picture!.width).toBe(Math.ceil(width + EXPORT_MARGIN * 2))
    expect(picture!.markup.startsWith("<svg xmlns=")).toBe(true)
    expect(picture!.markup.endsWith("</svg>")).toBe(true)
  })

  it("leaves nothing behind that only the app could read", () => {
    const { picture } = draw(
      document({
        elements: [node("r"), node("a"), node("t", { content: { $type: "task", text: "t", done: true } })],
        edges: [edge("r", "a"), edge("r", "t", { kind: "link", style: { endCap: "arrow" } })],
      }),
    )

    // A theme token resolves to nothing outside the app, and a marker painted from `context-stroke`
    // draws colourless in anything that is not a browser.
    expect(picture!.markup).not.toContain("var(--")
    expect(picture!.markup).not.toContain("color-mix")
    expect(picture!.markup).not.toContain("marker-end")
  })

  it("draws the paper only when one was asked for", () => {
    const opaque = draw(document()).picture!.markup
    const bare = draw(document(), { background: null }).picture!.markup

    expect(opaque.indexOf("<rect")).toBeLessThan(opaque.indexOf("<text"))
    expect(bare.split("<rect").length).toBe(opaque.split("<rect").length - 1)
  })

  it("puts the branches under the boxes, not over their labels", () => {
    const { picture } = draw(document())

    expect(picture!.markup.indexOf("<path")).toBeLessThan(picture!.markup.indexOf("<text"))
  })
})

describe("what a node is drawn as", () => {
  it("keeps the lines the box was measured around", () => {
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen"
    const { scene, picture } = draw(
      document({ elements: [node("r", { content: { $type: "text", text: long } })], edges: [] }),
    )

    const lines = scene.elements[0].text.lines
    expect(lines.length).toBeGreaterThan(1)
    expect(picture!.markup.split("<text").length - 1).toBe(lines.length)
  })

  it("strikes a finished task through and ticks its box", () => {
    const { picture } = draw(
      document({
        elements: [node("r"), node("t", { content: { $type: "task", text: "done", done: true } })],
        edges: [edge("r", "t")],
      }),
    )

    expect(picture!.markup).toContain("text-decoration=\"line-through\"")
    expect(picture!.markup).toContain("M20 6 9 17 4 12")
  })

  it("cuts a code body off at its box rather than letting it run across the map", () => {
    const source = "const x = 1".repeat(20)
    const { picture } = draw(
      document({
        elements: [node("r"), node("c", { content: { $type: "code", language: "ts", source } })],
        edges: [edge("r", "c")],
      }),
    )

    expect(picture!.markup).toContain("<clipPath")
    expect(picture!.markup).toContain("clip-path=\"url(#mm-clip-c)\"")
  })

  it("sizes the language chip in the face it is set in", () => {
    const seen: string[] = []
    draw(
      document({
        elements: [node("r"), node("c", { content: { $type: "code", language: "typescript", source: "x" } })],
        edges: [edge("r", "c")],
      }),
      {
        measureMono: (text, size, weight) => {
          seen.push(text)
          return estimateWidth(text, size, weight)
        },
      },
    )

    expect(seen).toContain("typescript")
  })

  it("says what an equation was, since a rendered one cannot leave the app", () => {
    const { picture } = draw(
      document({
        elements: [node("r"), node("m", { content: { $type: "math", latex: "a^2 + b^2" } })],
        edges: [edge("r", "m")],
      }),
    )

    expect(picture!.markup).toContain("font-style=\"italic\"")
    expect(picture!.markup).toContain("a^2 + b^2")
  })
})

describe("the file itself", () => {
  it("escapes a label rather than letting it become markup", () => {
    const { picture } = draw(
      document({ elements: [node("r", { content: { $type: "text", text: "<b>a & b</b>" } })], edges: [] }),
    )

    expect(picture!.markup).toContain("&lt;b&gt;a &amp; b&lt;/b&gt;")
    expect(picture!.markup).not.toContain("<b>")
  })

  it("gives a clip an id XML will take, whatever the map called the node", () => {
    const { picture } = draw(
      document({
        elements: [node("r"), node("a b/c", { content: { $type: "code", source: "x" } })],
        edges: [edge("r", "a b/c")],
      }),
    )

    expect(picture!.markup).toContain('id="mm-clip-a_b_c"')
  })
})
