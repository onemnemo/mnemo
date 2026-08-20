/**
 * The projector end to end: a stored document in, a scene the renderer can draw without asking
 * anything else out.
 */

import { describe, expect, it } from "vitest"

import type { MindmapDocument, MindmapEdge, MindmapElement, StyleTemplate } from "../model/document"
import type { Scene, SceneElement } from "../model/scene"

import type { RefInfo } from "./content"
import { estimateWidth, measurersFrom } from "./measure"
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
  measurers: measurersFrom(estimateWidth),
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

/**
 * What an edit costs the renderer.
 *
 * Every committed edit folds into a whole new document and reprojects it, and the canvas is a
 * memoized component per element. So whether an edit costs one render or five thousand comes down
 * entirely to whether the elements nobody touched come back as the objects they already were. Both
 * directions are the assertion: shared where nothing changed, and fresh wherever anything did,
 * including the several things that change an element without touching the element.
 *
 * Every test here holds one measurer set across its calls, because a different set is a different
 * box for the same words and is treated as a change like any other. The fixtures are built per test
 * rather than shared at module scope, so nothing depends on the order the file runs in.
 */
describe("projecting the same element twice", () => {
  const shared = (over: Partial<ProjectOptions> = {}): ProjectOptions =>
    options({ measurers: measurersFrom(estimateWidth), ...over })

  /** Root, two branches, one grandchild under the second, in objects nobody else has seen. */
  const fresh = (): MindmapDocument => ({
    id: "m",
    elements: [node("r"), node("a"), node("b"), node("deep")],
    edges: [branch("r", "a"), branch("r", "b"), branch("b", "deep")],
  })

  /** One committed edit, folded the way `applyDelta` folds one: touched ids replaced, the rest left. */
  const edit = (document: MindmapDocument, id: string, over: Partial<MindmapElement>): MindmapDocument => ({
    ...document,
    elements: document.elements!.map((element) => (element.id === id ? { ...element, ...over } : element)),
  })

  const find = (scene: Scene, id: string): SceneElement => scene.elements.find((element) => element.id === id)!

  it("hands back the very same object when nothing about it changed", () => {
    const document = fresh()
    const opts = shared()

    const before = projectScene(document, opts)
    const after = projectScene(edit(document, "a", { content: { $type: "text", text: "renamed" } }), opts)

    expect(find(after, "r")).toBe(find(before, "r"))
    expect(find(after, "b")).toBe(find(before, "b"))
    expect(find(after, "deep")).toBe(find(before, "deep"))
  })

  it("hands back a new object for the one that was edited", () => {
    const document = fresh()
    const opts = shared()

    const before = projectScene(document, opts)
    const after = projectScene(edit(document, "a", { content: { $type: "text", text: "renamed" } }), opts)

    expect(find(after, "a")).not.toBe(find(before, "a"))
    expect(find(after, "a").text.lines).toEqual(["renamed"])
  })

  it("hands back what a projection with nothing cached would have produced", () => {
    // The whole risk of a memo is that it is right about identity and wrong about content, which no
    // identity assertion can catch. A second measurer set misses every entry, so this is the same
    // document projected with the memo cold.
    const document = fresh()
    const opts = shared()

    projectScene(document, opts)
    const next = edit(document, "a", { content: { $type: "text", text: "renamed" } })

    expect(projectScene(next, opts)).toEqual(projectScene(next, shared()))
  })

  it("refreshes an element the document restyled without touching it", () => {
    const document = fresh()
    const opts = shared()

    const before = projectScene(document, opts)
    // The elements are the same objects; only the template the map resolves against changed.
    const after = projectScene({ ...document, canvas: { defaultTemplateId: RAINBOW.id } }, opts)

    expect(find(after, "a")).not.toBe(find(before, "a"))
    expect(find(after, "a").branchColor).toBe("var(--branch-1)")
    expect(find(after, "deep")).not.toBe(find(before, "deep"))
  })

  it("refreshes an element whose own template object was rewritten under it", () => {
    const document = fresh()
    const templates = measurersFrom(estimateWidth)
    const before = projectScene(document, options({ measurers: templates }))
    const after = projectScene(
      document,
      options({
        measurers: templates,
        templates: [{ ...DAWN, rootStyle: { ...DAWN.rootStyle, fill: "surfaceAlt" } }, RAINBOW],
      }),
    )

    expect(find(before, "r").fill).toBe("var(--accent)")
    expect(find(after, "r")).not.toBe(find(before, "r"))
    expect(find(after, "r").fill).toBe("var(--canvas-sunken)")
  })

  it("refreshes a node whose child count changed, which its own object cannot show", () => {
    const document = fresh()
    const opts = shared()

    const before = projectScene(document, opts)
    const after = projectScene(
      { ...document, elements: [...document.elements!, node("new")], edges: [...document.edges!, branch("a", "new")] },
      opts,
    )

    expect(find(after, "a")).not.toBe(find(before, "a"))
    expect(find(after, "a").childCount).toBe(1)
    // Its sibling gained nothing and is the object it already was.
    expect(find(after, "b")).toBe(find(before, "b"))
  })

  it("refreshes a node a reparent moved to another depth, which its own object cannot show", () => {
    const document = fresh()
    const opts = shared()

    const before = projectScene(document, opts)
    const after = projectScene(
      { ...document, edges: [branch("r", "a"), branch("r", "b"), branch("r", "deep")] },
      opts,
    )

    expect(before.elements.find((element) => element.id === "deep")!.nodeShape).toBe("plain")
    expect(find(after, "deep")).not.toBe(find(before, "deep"))
    expect(find(after, "deep").nodeShape).toBe("card")
  })

  it("refreshes a collapse, and leaves the branch beside it alone", () => {
    const document = fresh()
    const opts = shared()

    const before = projectScene(document, opts)
    const after = projectScene(edit(document, "b", { collapsed: true }), opts)

    expect(find(after, "b")).not.toBe(find(before, "b"))
    expect(find(after, "b").hiddenCount).toBe(1)
    expect(after.elements.map((element) => element.id)).toEqual(["r", "a", "b"])
    expect(find(after, "a")).toBe(find(before, "a"))
    expect(find(after, "r")).toBe(find(before, "r"))
  })

  it("refreshes a reference whose title arrived, and not one that only came back the same", () => {
    const document: MindmapDocument = {
      id: "m",
      elements: [node("n", { content: { $type: "note", noteId: "n1" } })],
    }
    const opts = (refs: ReadonlyMap<string, RefInfo> | undefined, measurers: ProjectOptions["measurers"]) =>
      options({ measurers, refs })
    const measurers = measurersFrom(estimateWidth)

    const pending = projectScene(document, opts(undefined, measurers))
    const arrived = projectScene(document, opts(new Map([["note:n1", { label: "Kidneys" }]]), measurers))
    // The resolution map is rebuilt on every document change, so this is a different object saying
    // the same thing, which is what a reference node sees on every unrelated edit.
    const again = projectScene(document, opts(new Map([["note:n1", { label: "Kidneys" }]]), measurers))

    expect(find(arrived, "n")).not.toBe(find(pending, "n"))
    expect(find(arrived, "n").text.lines).toEqual(["Kidneys"])
    expect(find(again, "n")).toBe(find(arrived, "n"))
  })

  it("shares a frame whose members stayed put, and rebuilds one whose members moved", () => {
    const shape = (id: string, x: number): MindmapElement => ({
      id,
      kind: "shape",
      content: { $type: "shape", shape: "rectangle" },
      x,
      y: 100,
      width: 100,
      height: 50,
    })
    const document: MindmapDocument = {
      id: "m",
      elements: [
        shape("s1", 100),
        shape("s2", 300),
        { id: "f", kind: "frame", content: { $type: "frame", title: "Group", childIds: ["s1", "s2"] } },
      ],
    }
    const opts = shared()

    const before = projectScene(document, opts)
    const still = projectScene({ ...document }, opts)
    const moved = projectScene(edit(document, "s1", { x: 40 }), opts)

    expect(find(still, "f")).toBe(find(before, "f"))
    expect(find(moved, "f")).not.toBe(find(before, "f"))
    expect(find(moved, "f").x).toBe(22)
    expect(find(moved, "s2")).toBe(find(before, "s2"))
  })

  it("shares nothing at all across a reload, which parses a whole new document", () => {
    // A reload and an import both replace every element object, identical content or not. Sharing
    // across one would mean a scene element outliving the document it was projected from.
    const document = fresh()
    const opts = shared()

    const before = projectScene(document, opts)
    const reloaded = projectScene(JSON.parse(JSON.stringify(document)) as MindmapDocument, opts)

    for (const element of reloaded.elements) {
      expect(element).not.toBe(find(before, element.id))
    }
    expect(reloaded).toEqual(before)
  })
})
