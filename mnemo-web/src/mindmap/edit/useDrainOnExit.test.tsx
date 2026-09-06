// @vitest-environment jsdom

/**
 * What the exit does about a map write that is already in the air.
 *
 * The host closes the window as soon as the handshake answers, so a write still in flight at that
 * point is lost with nothing on screen to say it was: the canvas shows the edit and the map reopens
 * without it. Every gesture sends its write and moves on, so this is the ordinary case rather than a
 * rare one.
 */

import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { onShutdown, resetShutdownForTests, runShutdown } from "@/app/shutdown"

import { mapKey, type EditOutcome, type MindmapOpsResult } from "../api"
import type { MindmapDocument, MindmapElement } from "../model/document"
import type { MindmapOp } from "../model/ops"

import { useDrainOnExit } from "./useDrainOnExit"
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

const SERVED: MindmapDocument = {
  id: ID,
  title: "Draft",
  revision: 5,
  elements: [node("a")],
  edges: [],
}

const RENAME: MindmapOp = { op: "set", id: "a", t: "renamed" }

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
  const document = useQuery({ queryKey: mapKey(ID), queryFn: () => Promise.resolve(SERVED) })
  editor = useMindmapEditor(ID, document.data?.revision)
  useDrainOnExit(editor)
  return null
}

/** Past the microtasks the queue and the handshake are chained on, and past a macrotask as well. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** A write the test decides when to land, standing in for one still crossing the wire at exit. */
function heldWrite(): { land: () => void; fail: (error: Error) => void } {
  let land!: () => void
  let fail!: (error: Error) => void
  const held = new Promise<EditOutcome>((resolve, reject) => {
    land = () => {
      resolve(applied())
    }
    fail = reject
  })
  mocks.applyMindmapOps.mockReturnValue(held)
  return { land, fail }
}

/** Whether the handshake has answered, which is the moment the host closes the window. */
function watch(exit: Promise<void>): { done: () => boolean; settled: Promise<void> } {
  let done = false
  const settled = exit.then(() => {
    done = true
  })
  return { done: () => done, settled }
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetShutdownForTests()
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
  resetShutdownForTests()
})

describe("closing the window with a map open", () => {
  it("waits for a write that was already in the air", async () => {
    const write = heldWrite()
    void editor.apply([RENAME], { label: "Rename" })

    const exit = watch(runShutdown())
    await settle()
    expect(exit.done()).toBe(false)

    await act(async () => {
      write.land()
      await exit.settled
    })
    expect(exit.done()).toBe(true)
  })

  it("answers at once when nothing is in flight", async () => {
    const exit = watch(runShutdown())
    await settle()

    expect(exit.done()).toBe(true)
    expect(mocks.applyMindmapOps).not.toHaveBeenCalled()
  })

  it("is not wedged by a write the request never completed", async () => {
    const write = heldWrite()
    // Caught here because the caller's handle is what reports a failure, and an uncaught rejection
    // in a test is a failure of its own.
    void editor.apply([RENAME], { label: "Rename" }).catch(() => undefined)

    const exit = watch(runShutdown())
    await act(async () => {
      write.fail(new Error("offline"))
      await exit.settled
    })

    expect(exit.done()).toBe(true)
  })

  it("waits for a write that joined the queue after it had started waiting", async () => {
    // Exit steps all run at once, so a step that sends a write sends it after this one has read the
    // queue. This one keeps its promise to itself, the way every gesture on the canvas does.
    const write = heldWrite()
    onShutdown(async () => {
      void editor.apply([RENAME], { label: "Rename" })
    })

    const exit = watch(runShutdown())
    await settle()
    expect(mocks.applyMindmapOps).toHaveBeenCalledTimes(1)
    expect(exit.done()).toBe(false)

    await act(async () => {
      write.land()
      await exit.settled
    })
    expect(exit.done()).toBe(true)
  })

  it("leaves a field's own exit step to finish the write that step started", async () => {
    // An open label flushes as its own step and awaits what it sends, so the two steps cover the
    // whole of the queue between them whichever order they were registered in.
    const write = heldWrite()
    onShutdown(() => editor.apply([RENAME], { label: "Rename" }))

    const exit = watch(runShutdown())
    await settle()
    expect(exit.done()).toBe(false)

    await act(async () => {
      write.land()
      await exit.settled
    })
    expect(exit.done()).toBe(true)
  })

  it("stops waiting on a map that has been closed", async () => {
    const write = heldWrite()
    void editor.apply([RENAME], { label: "Rename" })
    await act(async () => root.unmount())

    const exit = watch(runShutdown())
    await settle()

    expect(exit.done()).toBe(true)
    await act(async () => {
      write.land()
    })
  })
})
