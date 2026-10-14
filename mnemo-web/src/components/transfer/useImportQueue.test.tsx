// @vitest-environment jsdom

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"

import { toast } from "@/stores/toast"

import { MAX_QUEUED, type QueuedImport } from "./import-queue"
import type { ImportResultLike } from "./import-result"
import { announceImport, useImportQueue } from "./useImportQueue"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/stores/toast", () => ({ toast: { warning: vi.fn(), success: vi.fn() } }))

type Upload = { uploadId: string; name: string }

let pending: { name: string; resolve: (upload: Upload) => void }[]
const discard = vi.fn()
let queue: ReturnType<typeof useImportQueue<Upload, QueuedImport>>

function Harness() {
  queue = useImportQueue<Upload, QueuedImport>({
    upload: (file) => new Promise((resolve) => pending.push({ name: file.name, resolve })),
    discard,
    toRow: (key, upload) => ({ key, name: upload.name, sizeBytes: 1, status: "ready", uploadId: upload.uploadId }),
    accepts: (name) => name.endsWith(".md"),
    failureNote: () => "failed",
  })
  return null
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  pending = []
  vi.clearAllMocks()
  container = document.createElement("div")
  root = createRoot(container)
  act(() => root.render(<StrictMode><Harness /></StrictMode>))
})

afterEach(() => {
  act(() => root.unmount())
})

const picked = (...names: string[]) => names.map((name) => ({ file: new File(["x"], name), path: "" }))

const t = (_ns: string, key: string) => key
const landed = (succeededFiles: number): ImportResultLike => ({ succeededFiles, failedFiles: 0, warnings: [], errors: [] })

async function queueOf(count: number): Promise<void> {
  act(() => queue.add(picked(...Array.from({ length: count }, (_, i) => `n${String(i)}.md`))))
  await settleAll()
}

async function settleAll(): Promise<void> {
  // Settling one upload starts the next, so this loops until the pool runs dry.
  while (pending.length > 0) {
    await act(async () => {
      for (const upload of pending.splice(0)) upload.resolve({ uploadId: `id-${upload.name}`, name: upload.name })
      await Promise.resolve()
    })
  }
}

describe("useImportQueue", () => {
  it("uploads four at a time, skips repeats and refuses unknown types", async () => {
    act(() => queue.add(picked("a.md", "b.md", "c.md", "d.md", "e.md", "a.md", "x.png")))

    expect(queue.queue).toHaveLength(5)
    expect(pending).toHaveLength(4)
    expect(queue.refused).toEqual(["x.png"])

    await settleAll()
    expect(queue.queue.every((row) => row.status === "ready")).toBe(true)
  })

  it("stops at the queue limit and says so", () => {
    const many = Array.from({ length: MAX_QUEUED + 1 }, (_, i) => `n${String(i)}.md`)
    act(() => queue.add(picked(...many)))

    expect(queue.queue).toHaveLength(MAX_QUEUED)
    expect(queue.overflow).toBe(true)
  })

  it("imports in chunks and keeps a refused chunk staged", async () => {
    const names = Array.from({ length: 60 }, (_, i) => `n${String(i)}.md`)
    act(() => queue.add(picked(...names)))
    await settleAll()

    const run = vi.fn().mockResolvedValueOnce("first").mockRejectedValueOnce(new ApiError("no", 400))
    let outcome: Awaited<ReturnType<typeof queue.importReady>> | undefined
    await act(async () => {
      outcome = await queue.importReady(run)
    })

    expect(run.mock.calls.map(([rows]) => (rows as QueuedImport[]).length)).toEqual([50, 10])
    expect(outcome).toMatchObject({ results: ["first"], unsent: 10 })
    expect(queue.queue).toHaveLength(10)
  })

  it("hands staged uploads back when a row goes and when the dialog closes", async () => {
    act(() => queue.add(picked("a.md", "b.md")))
    await settleAll()

    act(() => queue.remove(queue.queue[0].key))
    expect(discard).toHaveBeenCalledWith("id-a.md")

    act(() => root.unmount())
    expect(discard).toHaveBeenCalledWith("id-b.md")
    root = createRoot(container)
  })

  it("hands back an upload whose row was removed while it was still going up", async () => {
    act(() => queue.add(picked("gone.md")))
    act(() => queue.remove(queue.queue[0].key))

    await settleAll()
    expect(discard).toHaveBeenCalledWith("id-gone.md")
    expect(queue.queue).toHaveLength(0)
  })

  it("hands back an upload that lands after the dialog closed", async () => {
    act(() => queue.add(picked("late.md")))
    act(() => root.unmount())

    await settleAll()
    expect(discard).toHaveBeenCalledWith("id-late.md")
    root = createRoot(container)
  })

  it("keeps uploads that land after a StrictMode remount", async () => {
    await queueOf(2)
    expect(queue.queue.every((row) => row.status === "ready")).toBe(true)
    expect(discard).not.toHaveBeenCalled()
  })

  it("reports a later chunk failing beside what landed, and closes", async () => {
    await queueOf(60)
    const run = vi.fn().mockResolvedValueOnce(landed(50)).mockRejectedValueOnce(new ApiError("down", 500))
    let outcome: Awaited<ReturnType<typeof queue.importReady<ImportResultLike>>> | undefined
    await act(async () => {
      outcome = await queue.importReady(run)
    })

    expect(outcome).toMatchObject({ unsent: 10, closed: false })
    expect(queue.queue).toHaveLength(0)
    expect(announceImport(t, outcome!, () => "phrase")).toBe(true)
    expect(toast.warning).toHaveBeenCalledWith("ImportCompleteTitle", expect.anything())
  })

  it("drops a first chunk that failed with anything but a 400, and stays open", async () => {
    await queueOf(60)
    const run = vi.fn().mockRejectedValueOnce(new ApiError("down", 500))
    let outcome: Awaited<ReturnType<typeof queue.importReady<ImportResultLike>>> | undefined
    await act(async () => {
      outcome = await queue.importReady(run)
    })

    expect(run).toHaveBeenCalledTimes(1)
    expect(queue.queue).toHaveLength(10)
    expect(announceImport(t, outcome!, () => "phrase")).toBe(false)
    expect(toast.warning).toHaveBeenCalledWith("ImportFailedTitle", expect.anything())
  })

  it("leaves the chunk in flight to the host when the dialog closes, and stops there", async () => {
    await queueOf(60)
    let finish: (result: ImportResultLike) => void = () => {}
    const run = vi.fn(() => new Promise<ImportResultLike>((resolve) => (finish = resolve)))
    let running: Promise<unknown> | undefined
    act(() => {
      running = queue.importReady(run)
    })

    act(() => root.unmount())
    const discarded = discard.mock.calls.map(([id]) => id as string)
    expect(discarded).toHaveLength(10)
    expect(discarded).not.toContain("id-n0.md")

    finish(landed(50))
    const outcome = (await running) as Parameters<typeof announceImport>[1]
    expect(run).toHaveBeenCalledTimes(1)
    expect(outcome.closed).toBe(true)
    expect(announceImport(t, outcome, () => "phrase")).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
    root = createRoot(container)
  })
})
