// @vitest-environment jsdom

/**
 * What the editor does with a write the server would not take.
 *
 * The canvas paints a batch as the gesture ends and the answer arrives afterwards, so anything the
 * server refuses has to be taken back off the screen. A conflict always was. A plain refusal, a
 * cycle or a validation error, was not: the edit stayed on the canvas, and the next write was
 * composed against a document the server does not have.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { mapKey, type EditOutcome, type MindmapEditError, type MindmapOpsResult } from "../api"
import type { MindmapDocument, MindmapElement } from "../model/document"
import type { MindmapOp } from "../model/ops"

import { useMindmapEditor, type MindmapEditor } from "./useMindmapEditor"

const ID = "map-1"

const mocks = vi.hoisted(() => ({
  applyMindmapOps: vi.fn(),
}))

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  applyMindmapOps: mocks.applyMindmapOps,
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/events/subscribers", () => ({
  onAppEvent: () => () => {},
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function node(id: string): MindmapElement {
  return { id, kind: "node", content: { $type: "text", text: id } }
}

/** What the server holds, and what a refetch is therefore going to bring back. */
const SERVED: MindmapDocument = {
  id: ID,
  title: "Draft",
  revision: 5,
  elements: [node("a")],
  edges: [],
}

const MOVE: MindmapOp = { op: "set", id: "a", t: "renamed" }

function refusal(code: MindmapEditError["code"]): EditOutcome {
  const error: MindmapEditError = {
    code,
    message: code,
    revision: 5,
    failedOpIndex: 0,
    contendedIds: null,
    suggestions: null,
  }
  return { status: code === "rev_conflict" ? "conflict" : "rejected", error }
}

function applied(): EditOutcome {
  const result: MindmapOpsResult = {
    revision: 6,
    baseRevision: 5,
    createdIds: {},
    deletedCount: 0,
    undo: { elements: [node("a")] },
    redo: { elements: [node("a")] },
    order: { elements: ["a"], edges: [] },
  }
  return { status: "applied", result }
}

let client: QueryClient
let container: HTMLElement
let root: Root
let editor: MindmapEditor

function Harness() {
  // An active observer, so invalidating the map actually refetches it the way the open canvas does.
  const document = useQuery({ queryKey: mapKey(ID), queryFn: () => Promise.resolve(SERVED) })
  editor = useMindmapEditor(ID, document.data?.revision)
  return null
}

function cached(): MindmapDocument | undefined {
  return client.getQueryData<MindmapDocument>(mapKey(ID))
}

/** Lets react-query's refetch settle; a rollback is one request away, not one microtask. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The canvas showing a batch it has sent but not yet had an answer for. */
function paintOptimistically(): void {
  client.setQueryData<MindmapDocument>(mapKey(ID), { ...SERVED, elements: [node("a"), node("ghost")] })
}

function elementIds(): string[] {
  return (cached()?.elements ?? []).map((element) => element.id)
}

beforeEach(async () => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = window.document.createElement("div")
  window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    )
  })
  await settle()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  client.clear()
})

describe("a write the server refuses", () => {
  it("takes a rejected batch back off the canvas, not only a conflicting one", async () => {
    expect(elementIds()).toEqual(["a"])
    paintOptimistically()
    expect(elementIds()).toEqual(["a", "ghost"])

    mocks.applyMindmapOps.mockResolvedValue(refusal("would_cycle"))
    await act(async () => {
      await editor.apply([MOVE], { label: "Move" })
    })
    await settle()

    // The refused edit is gone and the document on screen is the one the server actually holds.
    expect(elementIds()).toEqual(["a"])
    expect(editor.rejected?.code).toBe("would_cycle")
    expect(editor.reloaded).toBe(true)
  })

  it("reports the refusal for every code the protocol has, and rolls each one back", async () => {
    for (const code of ["not_found", "bad_content_type", "validation_error"] as const) {
      paintOptimistically()
      mocks.applyMindmapOps.mockResolvedValue(refusal(code))

      const result = await act(async () => editor.apply([MOVE], { label: "Move" }))
      await settle()

      expect(result).toBeNull()
      expect(elementIds()).toEqual(["a"])
      expect(editor.rejected?.code).toBe(code)
    }
  })

  it("still rolls back a conflict, which is the case that already worked", async () => {
    paintOptimistically()
    mocks.applyMindmapOps.mockResolvedValue(refusal("rev_conflict"))

    await act(async () => {
      await editor.apply([MOVE], { label: "Move" })
    })
    await settle()

    expect(elementIds()).toEqual(["a"])
    expect(editor.reloaded).toBe(true)
  })

  it("leaves an accepted write alone, so a landing edit is not refetched away", async () => {
    mocks.applyMindmapOps.mockResolvedValue(applied())

    await act(async () => {
      await editor.apply([MOVE], { label: "Move" })
    })
    await settle()

    expect(editor.rejected).toBeNull()
    expect(editor.reloaded).toBe(false)
    expect(cached()!.revision).toBe(6)
  })
})
