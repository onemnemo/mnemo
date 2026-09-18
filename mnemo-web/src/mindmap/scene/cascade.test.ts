/**
 * The cascade is a mirror of the desktop's resolver, so these pin the rules rather than the output of
 * this implementation. A map opened in both apps has to look the same in both.
 */

import { describe, expect, it } from "vitest"

import type { StyleTemplate } from "../model/document"

import { FREE_CONTEXT, resolveStyle, templateChain, type StyleContext } from "./cascade"

const at = (depth: number, branchIndex = -1): StyleContext => ({ depth, branchIndex, isRoot: depth === 0 })

const plainAtDepthOne: StyleTemplate = {
  id: "t",
  name: "T",
  rootStyle: { fill: "accent", textColor: "onAccent", fontScale: "l" },
  depthRules: [{ minDepth: 1, style: { nodeShape: "plain", fontScale: "s" } }],
}

const coloured: StyleTemplate = { ...plainAtDepthOne, id: "c", branchColors: "byBranch" }

describe("what wins", () => {
  it("takes the element's own value over any template", () => {
    const style = resolveStyle({ fill: "#112233" }, at(0), [plainAtDepthOne])

    expect(style.fill).toBe("#112233")
  })

  it("falls through to the template when the element says nothing", () => {
    expect(resolveStyle(null, at(0), [plainAtDepthOne]).fill).toBe("accent")
  })

  it("lets the first template in the chain win, property by property", () => {
    const specific: StyleTemplate = { id: "s", name: "S", rootStyle: { fill: "surfaceAlt" } }
    const style = resolveStyle(null, at(0), [specific, plainAtDepthOne])

    // Fill from the cluster template, text colour from the document one underneath it.
    expect(style.fill).toBe("surfaceAlt")
    expect(style.textColor).toBe("onAccent")
  })

  it("ends at the theme when nothing named anything", () => {
    const style = resolveStyle(null, at(2), [])

    expect(style).toMatchObject({
      fill: "surface",
      stroke: "stroke",
      textColor: "textPrimary",
      fontScale: "m",
      nodeShape: "card",
    })
  })
})

describe("a colour chosen for the root", () => {
  it("becomes the root's fill in place of the template's accent", () => {
    const style = resolveStyle({ stroke: "palette.3" }, at(0), [plainAtDepthOne])

    expect(style.fill).toBe("palette.3")
    expect(style.stroke).toBe("palette.3")
    // The ink stays the accent's, since the fill is still a full colour under it.
    expect(style.textColor).toBe("onAccent")
  })

  it("replaces a colour the root element names itself, which is how an assistant-written map arrives", () => {
    // Every element of such a map carries `fill: accent` on the element, not on a template.
    expect(resolveStyle({ stroke: "palette.3", fill: "accent" }, at(0), [plainAtDepthOne]).fill).toBe("palette.3")
    expect(resolveStyle({ stroke: "palette.3", fill: "palette.5" }, at(0), [plainAtDepthOne]).fill).toBe("palette.3")
    expect(resolveStyle({ stroke: "palette.3", fill: "#112233" }, at(0), []).fill).toBe("palette.3")
  })

  it("leaves a paper fill, whether the root or a neutral template names it", () => {
    expect(resolveStyle({ stroke: "palette.3", fill: "surfaceAlt" }, at(0), [plainAtDepthOne]).fill).toBe("surfaceAlt")

    const neutral: StyleTemplate = { ...plainAtDepthOne, rootStyle: { fill: "surfaceAlt" } }
    expect(resolveStyle({ stroke: "palette.3" }, at(0), [neutral]).fill).toBe("surfaceAlt")
    // No template at all is the same answer: the theme's surface is paper.
    expect(resolveStyle({ stroke: "palette.3" }, at(0), []).fill).toBe("surface")
  })

  it("stays the template's accent on a pill, which washes over its fill and keeps the paired ink", () => {
    expect(resolveStyle({ stroke: "palette.3", nodeShape: "pill" }, at(0), [plainAtDepthOne]).fill).toBe("accent")
    expect(resolveStyle({ stroke: "palette.3", nodeShape: "outline" }, at(0), [plainAtDepthOne]).fill).toBe("accent")
  })

  it("does not reach a child, whose stroke is a ring on its own card", () => {
    const style = resolveStyle({ stroke: "palette.3" }, at(1, 0), [plainAtDepthOne])

    expect(style.fill).toBe("surface")
  })
})

describe("depth rules", () => {
  it("apply the root style to a root and a depth rule to everything else", () => {
    expect(resolveStyle(null, at(0), [plainAtDepthOne]).fontScale).toBe("l")
    expect(resolveStyle(null, at(1), [plainAtDepthOne]).nodeShape).toBe("plain")
  })

  it("take the first band that contains the depth", () => {
    const banded: StyleTemplate = {
      id: "b",
      name: "B",
      depthRules: [
        { minDepth: 1, maxDepth: 1, style: { fontScale: "m" } },
        { minDepth: 2, style: { fontScale: "s" } },
      ],
    }

    expect(resolveStyle(null, at(1), [banded]).fontScale).toBe("m")
    expect(resolveStyle(null, at(9), [banded]).fontScale).toBe("s")
  })

  it("do not reach a free element, which has no depth to band", () => {
    // A caption or a shape keeps its own style over the theme; a template describes a tree it is
    // not in, and applying one would restyle loose canvas furniture as if it were a node.
    expect(resolveStyle(null, FREE_CONTEXT, [plainAtDepthOne]).nodeShape).toBe("card")
  })
})

describe("branch colour", () => {
  it("is off unless a template in the chain asks for it", () => {
    expect(resolveStyle(null, at(1, 0), [plainAtDepthOne]).branchColor).toBeNull()
  })

  it("maps branch slot zero to the first palette entry", () => {
    expect(resolveStyle(null, at(1, 0), [coloured]).branchColor).toBe("palette.1")
    expect(resolveStyle(null, at(1, 2), [coloured]).branchColor).toBe("palette.3")
  })

  it("wraps around the ramp rather than running off the end", () => {
    expect(resolveStyle(null, at(1, 8), [coloured]).branchColor).toBe("palette.1")
  })

  it("never colours a root, which belongs to no branch", () => {
    expect(resolveStyle(null, at(0), [coloured]).branchColor).toBeNull()
  })

  it("becomes the stroke when nothing else claimed it", () => {
    expect(resolveStyle(null, at(1, 1), [coloured]).stroke).toBe("palette.2")
  })

  it("loses the stroke to a template that states one outright", () => {
    const strict: StyleTemplate = {
      ...coloured,
      depthRules: [{ minDepth: 1, style: { stroke: "stroke" } }],
    }

    expect(resolveStyle(null, at(1, 1), [strict]).stroke).toBe("stroke")
    // Still reported, because the edges take their colour from it even when the node does not.
    expect(resolveStyle(null, at(1, 1), [strict]).branchColor).toBe("palette.2")
  })

  it("loses the stroke to the element's own", () => {
    expect(resolveStyle({ stroke: "#abcdef" }, at(1, 1), [coloured]).stroke).toBe("#abcdef")
  })
})

describe("the template chain", () => {
  const document: StyleTemplate = { id: "doc", name: "Doc" }
  const cluster: StyleTemplate = { id: "cluster", name: "Cluster" }
  const byId = new Map([
    [document.id, document],
    [cluster.id, cluster],
  ])

  it("is the document's alone when the cluster names none", () => {
    expect(templateChain(null, document, byId)).toEqual([document])
  })

  it("puts the cluster's in front of the document's", () => {
    expect(templateChain("cluster", document, byId)).toEqual([cluster, document])
  })

  it("does not list the same template twice", () => {
    expect(templateChain("doc", document, byId)).toEqual([document])
  })

  it("ignores a cluster template that no longer exists", () => {
    expect(templateChain("deleted", document, byId)).toEqual([document])
  })
})
