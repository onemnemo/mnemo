/**
 * The palette batch, which has to reach past a cluster that pinned a template of its own.
 */

import { describe, expect, it } from "vitest"

import type { ClusterSettings } from "../model/document"
import { palettePlan } from "./palette"

describe("choosing a palette", () => {
  it("is one document-wide write when no cluster pinned a template", () => {
    expect(palettePlan("study", [{ rootId: "r", layoutAlgorithm: "balanced" }])).toEqual([
      { op: "layout", template: "study" },
    ])
  })

  it("clears the cluster that pinned one, which would otherwise answer the cascade first", () => {
    const clusters: ClusterSettings[] = [
      { rootId: "r", templateId: "rainbow-branches" },
      { rootId: "s" },
      { rootId: "t", templateId: "blueprint" },
    ]

    // Cleared, not rewritten: a pin copied forward would go on shadowing every document-wide
    // write after this one.
    expect(palettePlan("study", clusters)).toEqual([
      { op: "layout", template: "study" },
      { op: "layout", root: "r", template: "" },
      { op: "layout", root: "t", template: "" },
    ])
  })

  it("leaves a cluster already on the chosen palette alone, so the batch stays the edit it is", () => {
    expect(palettePlan("study", [{ rootId: "r", templateId: "study" }])).toEqual([
      { op: "layout", template: "study" },
    ])
  })
})
