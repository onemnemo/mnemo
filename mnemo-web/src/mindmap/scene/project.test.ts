/**
 * The projector end to end: a stored document in, a scene the renderer can draw without asking
 * anything else out.
 */

import { describe, expect, it } from "vitest"

import type { MindmapDocument, MindmapEdge, MindmapElement, StyleTemplate } from "../model/document"

import { estimateWidth } from "./measure"
import { projectScene, type ProjectOptions } from "./project"

const DAWN: StyleTemplate = {
  id: "dawn-classic",
  name: "Dawn Classic",
  rootStyle: { fill: "accent", textColor: "onAccent", nodeShape: "card", fontScale: "l" },
  depthRules: [
    { minDepth: 1, maxDepth: 1, style: { nodeShape: "card", fontScale: "m" } },
    { minDepth: 2, style: { nodeShape: "plain", fontScale: "s" } },
  ],
  branchColors: "none",
}

const RAINBOW: StyleTemplate = { ...DAWN, id: "rainbow", name: "Rainbow", branchColors: "byBranch" }

const options = (over: Partial<ProjectOptions> = {}): ProjectOptions => ({
  templates: [DAWN, RAINBOW],
  defaultTemplateId: DAWN.id,
  measure: estimateWidth,
  ...over,
})

const node = (id: string, over: Partial<MindmapElement> = {}): MindmapElement => ({
  id,
  kind: "node",
  content: { $type: "text", text: id },
  ...over,
})

const branch = (from: string, to: string, over: Partial<MindmapEdge> = {}): MindmapEdge => ({
  id: `${from}-${to}`,
  fromId: from,
  toId: to,
  kind: "hierarchy",
  ...over,
})

/** Root, two branches, one grandchild under the second. */
const SAMPLE: MindmapDocument = {
  id: "m",
  elements: [node("r"), node("a"), node("b"), node("deep")],
  edges: [branch("r", "a"), branch("r", "b"), branch("b", "deep")],
}

describe("a projected element", () => {
  it("arrives with no holes left in it", () => {
    const scene = projectScene(SAMPLE, options())
    const root = scene.elements.find((e) => e.id === "r")!

    expect(root.fill).toBe("var(--accent)")
    expect(root.textColor).toBe("var(--accent-fg)")
    expect(root.nodeShape).toBe("card")
    expect(root.isRoot).toBe(true)
    expect(root.text.lines).toEqual(["r"])
    expect(root.width).toBeGreaterThan(0)
    expect(root.height).toBeGreaterThan(0)
  })

  it("gets its shape and size from where it sits, through the template", () => {
    const scene = projectScene(SAMPLE, options())

    expect(scene.elements.find((e) => e.id === "a")!.nodeShape).toBe("card")
    expect(scene.elements.find((e) => e.id === "deep")!.nodeShape).toBe("plain")
    expect(scene.elements.find((e) => e.id === "deep")!.text.fontSize).toBeLessThan(
      scene.elements.find((e) => e.id === "r")!.text.fontSize,
    )
  })

  it("carries a rule for a branch to land on only where there is no box", () => {
    const scene = projectScene(SAMPLE, options())

    expect(scene.elements.find((e) => e.id === "deep")!.underline).toBeGreaterThan(0)
    expect(scene.elements.find((e) => e.id === "a")!.underline).toBeUndefined()
  })

  it("keeps a size the document stored, which is a user's own resize", () => {
    const scene = projectScene(
      { ...SAMPLE, elements: [node("r", { width: 400, height: 90 })] },
      options(),
    )

    expect(scene.elements[0]).toMatchObject({ width: 400, height: 90 })
  })

  it("counts children, so a node can offer to collapse and say what it hid", () => {
    const scene = projectScene(SAMPLE, options())

    expect(scene.elements.find((e) => e.id === "r")!.childCount).toBe(2)
    expect(scene.elements.find((e) => e.id === "a")!.childCount).toBe(0)
  })
})

describe("branch colour", () => {
  it("stays off under a template that does not ask for it", () => {
    const scene = projectScene(SAMPLE, options())

    expect(scene.elements.find((e) => e.id === "a")!.branchColor).toBeUndefined()
  })

  it("gives each branch its own hue and hands it down", () => {
    const document = { ...SAMPLE, canvas: { defaultTemplateId: RAINBOW.id } }
    const scene = projectScene(document, options())

    expect(scene.elements.find((e) => e.id === "a")!.branchColor).toBe("var(--branch-1)")
    expect(scene.elements.find((e) => e.id === "b")!.branchColor).toBe("var(--branch-2)")
    expect(scene.elements.find((e) => e.id === "deep")!.branchColor).toBe("var(--branch-2)")
  })

  it("reaches the branches themselves, not only the nodes", () => {
    // The defect that made a coloured map draw entirely in slate grey: the edge has to carry the
    // colour, and it has to be the child's, so a branch reads as one thing from its first segment.
    const document = { ...SAMPLE, canvas: { defaultTemplateId: RAINBOW.id } }
    const scene = projectScene(document, options())

    expect(scene.edges.find((e) => e.id === "r-b")!.color).toBe("var(--branch-2)")
    expect(scene.edges.find((e) => e.id === "b-deep")!.color).toBe("var(--branch-2)")
  })
})

describe("a projected edge", () => {
  it("arrives routed, capped and patterned", () => {
    const scene = projectScene(SAMPLE, options())

    expect(scene.edges[0]).toMatchObject({ routing: "curve", lineStyle: "solid", endCap: "none" })
  })

  it("becomes a ribbon when the map asks for a taper", () => {
    const document: MindmapDocument = { ...SAMPLE, canvas: { edgeDefaults: { widthProfile: "taper" } } }
    const scene = projectScene(document, options())
    const trunk = scene.edges.find((e) => e.id === "r-a")!
    const twig = scene.edges.find((e) => e.id === "b-deep")!

    expect(trunk.fromWidth).toBeGreaterThan(trunk.toWidth!)
    expect(twig.fromWidth).toBeLessThan(trunk.fromWidth!)
  })

  it("stays a stroke without one, so nothing pays for a ribbon it did not ask for", () => {
    const scene = projectScene(SAMPLE, options())

    expect(scene.edges[0].fromWidth).toBeUndefined()
  })

  it("never tapers a cross-link, which is a remark and not a branch", () => {
    const document: MindmapDocument = {
      ...SAMPLE,
      edges: [...SAMPLE.edges!, { id: "x", fromId: "a", toId: "deep", kind: "link" }],
      canvas: { edgeDefaults: { widthProfile: "taper" } },
    }
    const scene = projectScene(document, options())

    expect(scene.edges.find((e) => e.id === "x")!.fromWidth).toBeUndefined()
  })
})

describe("a collapse", () => {
  const collapsed: MindmapDocument = {
    ...SAMPLE,
    elements: [node("r"), node("a"), node("b", { collapsed: true }), node("deep")],
  }

  it("leaves the hidden node out of the scene entirely", () => {
    const scene = projectScene(collapsed, options())

    expect(scene.elements.map((e) => e.id)).toEqual(["r", "a", "b"])
  })

  it("takes the branch feeding it out too, rather than drawing one into nowhere", () => {
    const scene = projectScene(collapsed, options())

    expect(scene.edges.map((e) => e.id)).toEqual(["r-a", "r-b"])
  })

  it("tells the collapsed node how much it is holding", () => {
    const scene = projectScene(collapsed, options())

    expect(scene.elements.find((e) => e.id === "b")!.hiddenCount).toBe(1)
  })
})

describe("free elements", () => {
  const withShape: MindmapDocument = {
    id: "m",
    elements: [node("r"), { id: "s", kind: "shape", content: { $type: "shape", shape: "ellipse" }, x: 40, y: 50 }],
  }

  it("are drawn, at the position they were left at", () => {
    const scene = projectScene(withShape, options())

    expect(scene.elements.find((e) => e.id === "s")).toMatchObject({ x: 40, y: 50, depth: -1 })
  })

  it("keep the theme's defaults, because a template describes a tree they are not in", () => {
    const scene = projectScene({ ...withShape, canvas: { defaultTemplateId: DAWN.id } }, options())

    expect(scene.elements.find((e) => e.id === "s")!.fill).toBe("var(--canvas)")
  })
})

describe("the document as a whole", () => {
  it("carries its own background, since that is a property of the map and not of the app", () => {
    expect(projectScene({ ...SAMPLE, canvas: { background: "grid" } }, options()).background).toBe("grid")
    expect(projectScene(SAMPLE, options()).background).toBe("dots")
  })

  it("projects an empty document to an empty scene rather than throwing", () => {
    const scene = projectScene({ id: "m" }, options())

    expect(scene.elements).toEqual([])
    expect(scene.edges).toEqual([])
  })

  it("falls back to the shipped default when a map names a template that is gone", () => {
    // A deleted template must not strip a map back to bare theme defaults; the desktop resolves the
    // same way, so the two apps agree about what a map with a dangling reference looks like.
    const scene = projectScene({ ...SAMPLE, canvas: { defaultTemplateId: "gone" } }, options())

    expect(scene.elements).toHaveLength(4)
    expect(scene.elements[0].fill).toBe("var(--accent)")
  })

  it("falls back to no template at all when even the default is missing", () => {
    const scene = projectScene(SAMPLE, options({ templates: [], defaultTemplateId: "gone" }))

    expect(scene.elements[0].fill).toBe("var(--canvas)")
  })

  it("takes a cluster's template over the document's", () => {
    const document: MindmapDocument = {
      ...SAMPLE,
      canvas: { defaultTemplateId: DAWN.id },
      clusters: [{ rootId: "r", templateId: RAINBOW.id }],
    }
    const scene = projectScene(document, options())

    expect(scene.elements.find((e) => e.id === "a")!.branchColor).toBe("var(--branch-1)")
  })
})

describe("frames", () => {
  const shape = (id: string, x: number, y: number): MindmapElement => ({
    id,
    kind: "shape",
    content: { $type: "shape", shape: "rectangle" },
    x,
    y,
    width: 100,
    height: 50,
  })

  const withFrame = (childIds: string[], over: Partial<MindmapElement> = {}): MindmapDocument => ({
    id: "m",
    elements: [
      shape("s1", 100, 100),
      shape("s2", 300, 200),
      {
        id: "f",
        kind: "frame",
        content: { $type: "frame", title: "Group", childIds },
        // Deliberately nowhere near its members: a frame is wherever they are, and a stored box that
        // still decided anything would put this one somewhere else.
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        ...over,
      },
    ],
  })

  const frameOf = (document: MindmapDocument) =>
    projectScene(document, options()).elements.find((e) => e.id === "f")!

  it("takes their bounds from their members, not from what was stored", () => {
    // Members span 100,100 to 400,250, and the frame stands 18 off that with a 22 strip on top.
    expect(frameOf(withFrame(["s1", "s2"]))).toMatchObject({
      x: 82,
      y: 60,
      width: 336,
      height: 208,
    })
  })

  it("count the members that are actually drawn", () => {
    expect(frameOf(withFrame(["s1", "s2", "gone"])).childCount).toBe(2)
  })

  it("keep their stored box when nothing is left to derive one from", () => {
    // A group with no area is one nobody could see to drop anything back into.
    expect(frameOf(withFrame([]))).toMatchObject({ x: 0, y: 0, width: 10, height: 10, childCount: 0 })
  })

  it("are drawn first, because a frame is a backdrop for its members", () => {
    const scene = projectScene(withFrame(["s1", "s2"]), options())

    expect(scene.elements[0].id).toBe("f")
  })
})
