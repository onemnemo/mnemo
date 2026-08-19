/**
 * The rule that decides whether a write can be patched into the open document instead of refetched.
 *
 * Worth its own tests because the failure mode is silent. A delta names ids and rewrites them
 * verbatim; folded into a document it was not computed from it does not throw, it produces a map
 * that renders perfectly and is wrong. Every case below is an interleave where that would happen.
 */

import { QueryClient } from "@tanstack/react-query"
import { beforeEach, describe, expect, it } from "vitest"

import {
  foldEditIntoCache,
  foldNoticeIntoCache,
  foldRestoreIntoCache,
  mapKey,
  type MindmapOpsResult,
} from "./api"
import type { MindmapDocument, MindmapElement } from "./model/document"

const ID = "map-1"

function node(id: string, text = id): MindmapElement {
  return { id, kind: "node", content: { $type: "text", text } }
}

function document(revision: number): MindmapDocument {
  return { id: ID, title: "Draft", revision, elements: [node("a")], edges: [] }
}

function opsResult(over: Partial<MindmapOpsResult> = {}): MindmapOpsResult {
  return {
    revision: 5,
    baseRevision: 4,
    createdIds: {},
    deletedCount: 0,
    undo: { removeElementIds: ["b"] },
    redo: { elements: [node("b")] },
    order: { elements: ["a", "b"], edges: [] },
    ...over,
  }
}

let client: QueryClient

beforeEach(() => {
  client = new QueryClient()
})

function cached(): MindmapDocument | undefined {
  return client.getQueryData<MindmapDocument>(mapKey(ID))
}

describe("folding an accepted edit", () => {
  it("patches the cached document when we hold the revision it applied against", () => {
    client.setQueryData(mapKey(ID), document(4))

    expect(foldEditIntoCache(client, ID, opsResult())).toBe(true)
    expect(cached()!.revision).toBe(5)
    expect(cached()!.elements!.map((e) => e.id)).toEqual(["a", "b"])
  })

  it("refuses a batch the server rebased onto a revision we never saw", () => {
    // A stale but non-contending batch is rebased server-side, so it lands on a document that has
    // somebody else's write in it. The revision still moves by one, which is why the old "did it
    // advance by one" check passed here and folded a delta describing a document we do not hold.
    client.setQueryData(mapKey(ID), document(2))

    expect(foldEditIntoCache(client, ID, opsResult({ baseRevision: 4, revision: 5 }))).toBe(false)
    expect(cached()!.revision).toBe(2)
    expect(cached()!.elements!.map((e) => e.id)).toEqual(["a"])
  })

  it("refuses when somebody committed between our write leaving and its answer coming back", () => {
    client.setQueryData(mapKey(ID), document(4))
    // The notice for the other write landed first and moved the cache on.
    client.setQueryData(mapKey(ID), document(5))

    expect(foldEditIntoCache(client, ID, opsResult({ baseRevision: 4, revision: 5 }))).toBe(false)
  })

  it("refuses when there is nothing cached to fold into", () => {
    expect(foldEditIntoCache(client, ID, opsResult())).toBe(false)
  })

  it("refuses a write that reported no delta, so the caller refetches instead of guessing", () => {
    client.setQueryData(mapKey(ID), document(4))

    expect(foldEditIntoCache(client, ID, opsResult({ redo: null }))).toBe(false)
    expect(foldEditIntoCache(client, ID, opsResult({ order: null }))).toBe(false)
    expect(cached()!.revision).toBe(4)
  })

  it("carries a rename through, because a rename is an edit with a title on its delta", () => {
    client.setQueryData(mapKey(ID), document(4))

    foldEditIntoCache(client, ID, opsResult({ redo: { title: "Final" }, undo: { title: "Draft" } }))

    expect(cached()!.title).toBe("Final")
    expect(cached()!.revision).toBe(5)
  })
})

describe("folding a replayed undo", () => {
  it("applies the delta the caller sent, against the revision the replay landed on", () => {
    client.setQueryData(mapKey(ID), document(4))

    const folded = foldRestoreIntoCache(
      client,
      ID,
      { removeElementIds: ["a"] },
      { revision: 5, baseRevision: 4, order: { elements: [], edges: [] } },
    )

    expect(folded).toBe(true)
    expect(cached()!.elements).toEqual([])
  })

  it("refuses when the cache moved on under the replay", () => {
    client.setQueryData(mapKey(ID), document(6))

    const folded = foldRestoreIntoCache(
      client,
      ID,
      { removeElementIds: ["a"] },
      { revision: 5, baseRevision: 4, order: null },
    )

    expect(folded).toBe(false)
    expect(cached()!.elements!.map((e) => e.id)).toEqual(["a"])
  })
})

describe("folding somebody else's write", () => {
  it("absorbs it when we hold exactly the revision it landed on", () => {
    // The assistant or an import editing the map that is open. Absorbing it is what leaves the
    // person reviewing that rewrite with one Ctrl+Z rather than an emptied stack.
    client.setQueryData(mapKey(ID), document(4))

    const folded = foldNoticeIntoCache(client, ID, { elements: [node("b")] }, 4, 5, {
      elements: ["a", "b"],
      edges: [],
    })

    expect(folded).toBe(true)
    expect(cached()!.revision).toBe(5)
  })

  it("refuses on any other revision, same rule as our own writes", () => {
    client.setQueryData(mapKey(ID), document(3))

    const folded = foldNoticeIntoCache(client, ID, { elements: [node("b")] }, 4, 5, {
      elements: ["a", "b"],
      edges: [],
    })

    expect(folded).toBe(false)
    expect(cached()!.revision).toBe(3)
  })
})
