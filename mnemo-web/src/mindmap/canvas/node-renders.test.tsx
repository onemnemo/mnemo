// @vitest-environment jsdom

/**
 * What a committed edit costs the canvas in renders.
 *
 * The canvas is one memoized component per element, keyed by id, so an edit is supposed to cost one
 * render. It did not: the projector built a fresh scene element for every element on every call, and
 * a fresh object is a changed prop, so every node on the map re-ran its body on every keystroke that
 * committed. The DOM survived, because the key was stable, which is exactly why the cost was
 * invisible and why it is pinned here rather than left to a rendering assertion.
 *
 * The counting is done twice over, from two directions. `useT` is the first thing the real component
 * calls, so a spy on it counts real render bodies across the whole tree; and a probe sitting inside
 * its own `memo`, with the same props and the same default comparison, says which element each of
 * those belonged to. Neither is a stand-in for the component: both wrap it while it renders.
 */

import { act, memo } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { estimateWidth, measurersFrom } from "../scene/measure"
import { projectScene, type ProjectOptions } from "../scene/project"
import type { MindmapDocument, MindmapElement, StyleTemplate } from "../model/document"
import type { Scene, SceneElement } from "../model/scene"
import { MindmapNode } from "./MindmapNode"

let bodies = 0

vi.mock("@/i18n/useT", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/i18n/useT")>()
  return {
    ...real,
    useT: () => {
      bodies += 1
      return real.useT()
    },
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DAWN: StyleTemplate = {
  id: "dawn-classic",
  name: "Dawn Classic",
  rootStyle: { fill: "accent", textColor: "onAccent", nodeShape: "card", fontScale: "l" },
  depthRules: [{ minDepth: 1, style: { nodeShape: "card", fontScale: "m" } }],
}

/** A root with `count` children hanging off it, in objects nobody else has seen. */
function mapOf(count: number): MindmapDocument {
  const elements: MindmapElement[] = [{ id: "r", kind: "node", content: { $type: "text", text: "root" } }]
  const edges = []
  for (let i = 0; i < count; i++) {
    elements.push({ id: `n${i}`, kind: "node", content: { $type: "text", text: `node ${i}` } })
    edges.push({ id: `e${i}`, fromId: "r", toId: `n${i}`, kind: "hierarchy" as const })
  }
  return { id: "m", elements, edges }
}

/** One committed edit, folded the way `applyDelta` folds one: touched ids replaced, the rest left. */
function retitle(source: MindmapDocument, id: string, text: string): MindmapDocument {
  return {
    ...source,
    elements: source.elements!.map((element) =>
      element.id === id ? { ...element, content: { $type: "text", text } } : element,
    ),
  }
}

const counts = new Map<string, number>()

/**
 * The canvas's own mapping, with a probe between the list and the component.
 *
 * `memo` here is React's, with the default shallow comparison, which is the one wrapping the real
 * component a line below. So the body runs exactly when the real one's does.
 */
const Probe = memo(function Probe({ element }: { element: SceneElement }) {
  counts.set(element.id, (counts.get(element.id) ?? 0) + 1)
  return <MindmapNode element={element} />
})

function World({ scene }: { scene: Scene }) {
  return (
    <div>
      {scene.elements.map((element) => (
        <Probe key={element.id} element={element} />
      ))}
    </div>
  )
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  counts.clear()
  bodies = 0
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("a committed edit", () => {
  const SIZE = 40

  it("re-runs one node's render body and lets every other node bail", () => {
    const opts: ProjectOptions = {
      templates: [DAWN],
      defaultTemplateId: DAWN.id,
      // Held across both projections, because a different measurer set is a different box for the
      // same words and the projector treats it as a change like any other.
      measurers: measurersFrom(estimateWidth),
    }
    const source = mapOf(SIZE)

    act(() => root.render(<World scene={projectScene(source, opts)} />))

    expect(counts.get("n7")).toBe(1)
    expect(bodies).toBe(SIZE + 1)

    counts.clear()
    bodies = 0

    act(() => root.render(<World scene={projectScene(retitle(source, "n7", "renamed"), opts)} />))

    expect(counts.get("n7")).toBe(1)
    expect(bodies).toBe(1)
    // Everything else bailed rather than being unmounted: the DOM is still whole.
    expect(container.querySelectorAll("[data-mm-id]")).toHaveLength(SIZE + 1)
    expect(container.textContent).toContain("renamed")
  })

  it("does not bail on anything when the whole document was replaced", () => {
    // A reload parses every element afresh, so nothing can be shared and nothing should be. The
    // guard against a memo that is right about the cheap case and silently stale about this one.
    const opts: ProjectOptions = {
      templates: [DAWN],
      defaultTemplateId: DAWN.id,
      measurers: measurersFrom(estimateWidth),
    }
    const source = mapOf(SIZE)

    act(() => root.render(<World scene={projectScene(source, opts)} />))

    counts.clear()
    bodies = 0

    const reloaded = JSON.parse(JSON.stringify(source)) as MindmapDocument
    act(() => root.render(<World scene={projectScene(reloaded, opts)} />))

    expect(bodies).toBe(SIZE + 1)
  })
})
