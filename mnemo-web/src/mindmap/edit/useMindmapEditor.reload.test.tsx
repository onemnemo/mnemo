// @vitest-environment jsdom

/**
 * What the editor does with an answer that lands after the map moved under it.
 *
 * A write is in the air, an outside writer commits right behind it, and the notice for that commit
 * reaches the editor before the write's own HTTP response does. The notice drops the undo stack
 * and starts a refetch. The response then arrives applied, against the revision it was sent from,
 * and the only right thing to do with it is nothing: the refetch is bringing the document, and a
 * step recorded on a fresh stack would offer an undo for a revision the server has left behind.
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { notifySubscribers, resetSubscribersForTests } from "@/events/subscribers"
import { EventType } from "@/events/types"

import { mapKey, type EditOutcome, type MindmapOpsResult, type MindmapRestoreResult } from "../api"
import type { MindmapDocument, MindmapElement } from "../model/document"
import type { MindmapChangedNotice } from "../model/live-revision"
import type { MindmapOp } from "../model/ops"

import { useMindmapEditor, type MindmapEditor } from "./useMindmapEditor"

const ID = "map-1"

const mocks = vi.hoisted(() => ({
  applyMindmapOps: vi.fn(),
  restoreMindmap: vi.fn(),
}))

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  applyMindmapOps: mocks.applyMindmapOps,
  restoreMindmap: mocks.restoreMindmap,
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

function node(id: string, text = id): MindmapElement {
  return { id, kind: "node", content: { $type: "text", text } }
}

function document(revision: number, text: string): MindmapDocument {
  return { id: ID, title: "Draft", revision, elements: [node("a", text)], edges: [] }
}

const MOVE: MindmapOp = { op: "set", id: "a", t: "renamed" }

/** A promise handed out now and settled by the test when the ordering calls for it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function applied(revision: number, baseRevision: number): EditOutcome {
  const result: MindmapOpsResult = {
    revision,
    baseRevision,
    createdIds: {},
    deletedCount: 0,
    undo: { elements: [node("a")] },
    redo: { elements: [node("a", "renamed")] },
    order: { elements: ["a"], edges: [] },
  }
  return { status: "applied", result }
}

function restored(revision: number, baseRevision: number): { status: "applied"; result: MindmapRestoreResult } {
  return { status: "applied", result: { revision, baseRevision, order: { elements: ["a"], edges: [] } } }
}

function notice(revision: number): void {
  const data: MindmapChangedNotice = { mapId: ID, revision, baseRevision: revision - 1, kind: "edited" }
  notifySubscribers({ type: EventType.MindmapChanged, data })
}

let client: QueryClient
let container: HTMLElement
let root: Root
let editor: MindmapEditor
/** Every fetch after the first waits here, so the test decides when the refetch lands. */
let refetch: ReturnType<typeof deferred<MindmapDocument>>
let fetches: number

function Harness() {
  const query = useQuery({
    queryKey: mapKey(ID),
    queryFn: () => {
      fetches += 1
      return fetches === 1 ? Promise.resolve(document(5, "a")) : refetch.promise
    },
  })
  editor = useMindmapEditor(ID, query.data?.revision)
  return null
}

function cached(): MindmapDocument | undefined {
  return client.getQueryData<MindmapDocument>(mapKey(ID))
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetSubscribersForTests()
  fetches = 0
  refetch = deferred<MindmapDocument>()
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
  resetSubscribersForTests()
})

/** Sends a write and holds its answer, so notices can arrive while it is in the air. */
async function sendHeldWrite(): Promise<ReturnType<typeof deferred<EditOutcome>>> {
  const answer = deferred<EditOutcome>()
  mocks.applyMindmapOps.mockReturnValue(answer.promise)
  await act(async () => {
    void editor.apply([MOVE], { label: "Move" })
  })
  await settle()
  expect(mocks.applyMindmapOps).toHaveBeenCalledWith(ID, 5, [MOVE])
  return answer
}

/** Our commit's echo, then a stranger's commit right behind it, both before our answer. */
async function overtake(): Promise<void> {
  await act(async () => {
    notice(6)
    notice(7)
  })
  await settle()
  expect(editor.reloaded).toBe(true)
  expect(editor.canUndo).toBe(false)
  expect(fetches).toBe(2)
  expect(cached()!.revision).toBe(5)
}

describe("a write whose answer lands after the map was reloaded", () => {
  it("is neither folded nor recorded, and leaves the reload notice up", async () => {
    const answer = await sendHeldWrite()
    await overtake()

    await act(async () => {
      answer.resolve(applied(6, 5))
    })
    await settle()

    // The refetch is bringing revision 7; folding this answer into the copy it is replacing and
    // recording a step against a stack that was dropped would offer an undo the server refuses.
    expect(editor.reloaded).toBe(true)
    expect(editor.canUndo).toBe(false)
    expect(cached()!.revision).toBe(5)

    await act(async () => {
      refetch.resolve(document(7, "external"))
    })
    await settle()

    expect(cached()!.revision).toBe(7)
    expect(editor.canUndo).toBe(false)
    expect(editor.reloaded).toBe(true)
  })

  it("is refused on the fold when the refetch lands first, as before", async () => {
    const answer = await sendHeldWrite()
    await overtake()

    await act(async () => {
      refetch.resolve(document(7, "external"))
    })
    await settle()
    expect(cached()!.revision).toBe(7)

    await act(async () => {
      answer.resolve(applied(6, 5))
    })
    await settle()

    expect(editor.canUndo).toBe(false)
    expect(editor.reloaded).toBe(true)
    expect(cached()!.revision).toBe(7)
  })

  it("does not put the dropped stack back when the overtaken write was an undo", async () => {
    // Land one write cleanly, so there is a step to undo.
    mocks.applyMindmapOps.mockResolvedValue(applied(6, 5))
    await act(async () => {
      await editor.apply([MOVE], { label: "Move" })
    })
    await settle()
    expect(editor.canUndo).toBe(true)
    expect(cached()!.revision).toBe(6)

    // Press undo and hold the answer while a stranger commits behind it.
    const answer = deferred<ReturnType<typeof restored>>()
    mocks.restoreMindmap.mockReturnValue(answer.promise)
    await act(async () => {
      editor.undo()
    })
    await settle()
    expect(mocks.restoreMindmap).toHaveBeenCalledWith(ID, 6, expect.anything())

    await act(async () => {
      notice(7)
      notice(8)
    })
    await settle()
    expect(editor.reloaded).toBe(true)
    expect(editor.canUndo).toBe(false)
    expect(editor.canRedo).toBe(false)

    await act(async () => {
      answer.resolve(restored(7, 6))
    })
    await settle()

    // Settling the popped stack would put the step back on the redo branch at revision 7, and the
    // server is at 8.
    expect(editor.canRedo).toBe(false)
    expect(editor.canUndo).toBe(false)
    expect(editor.reloaded).toBe(true)
    expect(cached()!.revision).toBe(6)
  })
})
