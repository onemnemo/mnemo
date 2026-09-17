// @vitest-environment jsdom

/**
 * A blank node abandoned as soon as it was made.
 *
 * Tab adds a child with the caret in it; Escape takes the untitled child away again. Recorded as
 * two steps, the next Ctrl+Z would bring an empty box back, and the edit made before the Tab would
 * be three presses away. The delete of a node the previous step created retracts that step instead.
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { mapKey, type EditOutcome, type MindmapOpsResult } from "../api"
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

function node(id: string, text = id): MindmapElement {
  return { id, kind: "node", content: { $type: "text", text } }
}

const SERVED: MindmapDocument = {
  id: ID,
  title: "Draft",
  revision: 5,
  elements: [node("root")],
  edges: [],
}

const ADD: MindmapOp = { op: "add", under: "root", nodes: [{ ref: "n", t: "" }] }
const DELETE: MindmapOp = { op: "del", ids: ["n1"] }
const RENAME: MindmapOp = { op: "set", id: "root", t: "renamed" }

let revision = 5

/** The server's answer to a batch that landed: the next revision and the delta pair the batch made. */
function landed(undo: MindmapOpsResult["undo"], redo: MindmapOpsResult["redo"], elements: string[]): EditOutcome {
  revision += 1
  const result: MindmapOpsResult = {
    revision,
    baseRevision: revision - 1,
    createdIds: { n: "n1" },
    deletedCount: 0,
    undo,
    redo,
    order: { elements, edges: elements.includes("n1") ? ["e1"] : [] },
  }
  return { status: "applied", result }
}

function added(): EditOutcome {
  return landed(
    { removeElementIds: ["n1"], removeEdgeIds: ["e1"] },
    { elements: [node("n1", "")], edges: [{ id: "e1", fromId: "root", toId: "n1" }] },
    ["root", "n1"],
  )
}

function deleted(): EditOutcome {
  return landed(
    { elements: [node("n1", "")], edges: [{ id: "e1", fromId: "root", toId: "n1" }] },
    { removeElementIds: ["n1"], removeEdgeIds: ["e1"] },
    ["root"],
  )
}

function renamed(): EditOutcome {
  return landed({ elements: [node("root")] }, { elements: [node("root", "renamed")] }, ["root", "n1"])
}

let client: QueryClient
let container: HTMLElement
let root: Root
let editor: MindmapEditor

function Harness() {
  const document = useQuery({ queryKey: mapKey(ID), queryFn: () => Promise.resolve(SERVED) })
  editor = useMindmapEditor(ID, document.data?.revision)
  return null
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function apply(ops: MindmapOp[], step: Parameters<MindmapEditor["apply"]>[1], answer: EditOutcome) {
  mocks.applyMindmapOps.mockResolvedValueOnce(answer)
  await act(async () => {
    await editor.apply(ops, step)
  })
  await settle()
}

beforeEach(async () => {
  vi.clearAllMocks()
  revision = 5
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  container = window.document.createElement("div")
  window.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>
      </StrictMode>,
    )
  })
  await settle()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  client.clear()
})

describe("deleting the node the previous step created", () => {
  it("retracts that step instead of adding one, so the stack is where it was before the add", async () => {
    await apply([RENAME], { label: "Rename" }, renamed())
    await apply([ADD], { label: "AddNode" }, added())
    expect(editor.undoLabel).toBe("AddNode")

    await apply([DELETE], { label: "Delete", retracts: "n1" }, deleted())

    expect(editor.undoLabel).toBe("Rename")
    expect(editor.canRedo).toBe(false)
    expect(client.getQueryData<MindmapDocument>(mapKey(ID))!.revision).toBe(8)
  })

  it("is an ordinary step when something else was recorded since the add", async () => {
    await apply([ADD], { label: "AddNode" }, added())
    await apply([RENAME], { label: "Rename" }, renamed())

    await apply([DELETE], { label: "Delete", retracts: "n1" }, deleted())

    expect(editor.undoLabel).toBe("Delete")
  })

  it("is an ordinary step when the stack is empty", async () => {
    await apply([DELETE], { label: "Delete", retracts: "n1" }, deleted())

    expect(editor.undoLabel).toBe("Delete")
    expect(editor.canUndo).toBe(true)
  })
})
