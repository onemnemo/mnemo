/**
 * The disposer's contract, which the doc comment on connectEventStream states as
 * "delivers parsed events until disposed". Disposal races the network: the fetch can
 * resolve, and frames can already be sitting in the reader, in the window between the
 * disposer running and the abort actually landing. Nothing delivered after that point
 * belongs to anybody, and under StrictMode's deliberate double invoke the window is hit
 * on every dev boot.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { connectEventStream } from "./sse-client"

vi.mock("@/api/client", () => ({ apiToken: () => "test-token" }))

/** Lets the stream's reads and the fetch promise settle before asserting. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function frame(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/** A response body the test feeds by hand, so a frame can be pushed after disposal. */
function pushableBody(): { body: ReadableStream<Uint8Array>; push: (chunk: string) => void; close: () => void } {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c
    },
  })
  return {
    body,
    push: (chunk) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("connectEventStream disposal", () => {
  it("does not report open for a connection that was already disposed", async () => {
    // The fetch is held until after the disposer runs, which is the race: the abort has
    // not landed, so the request still resolves and run() carries on.
    let resolveFetch!: (response: Response) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve))),
    )
    const onOpen = vi.fn()
    const onEvent = vi.fn()

    const dispose = connectEventStream({ onEvent, onOpen })
    dispose()
    resolveFetch(new Response(pushableBody().body))
    await settle()

    expect(onOpen).not.toHaveBeenCalled()
  })

  it("stops delivering events once disposed", async () => {
    const stream = pushableBody()
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(stream.body))))
    const onEvent = vi.fn()

    const dispose = connectEventStream({ onEvent })
    stream.push(frame("note-changed", { id: "before" }))
    await settle()
    expect(onEvent).toHaveBeenCalledTimes(1)

    dispose()
    stream.push(frame("note-changed", { id: "after" }))
    await settle()

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ data: { id: "after" } }))
  })

  it("still delivers while the stream is live", async () => {
    // The guards must not cost the ordinary path, so this is the arm that would catch a
    // fix that simply stopped delivering anything.
    const stream = pushableBody()
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(stream.body))))
    const onEvent = vi.fn()
    const onOpen = vi.fn()

    const dispose = connectEventStream({ onEvent, onOpen })
    stream.push(frame("note-changed", { id: "one" }))
    stream.push(frame("deck-changed", { id: "two" }))
    await settle()

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onEvent).toHaveBeenNthCalledWith(1, { type: "note-changed", data: { id: "one" } })
    expect(onEvent).toHaveBeenNthCalledWith(2, { type: "deck-changed", data: { id: "two" } })
    dispose()
  })
})
