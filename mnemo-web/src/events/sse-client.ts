import { apiToken } from "@/api/client"

import type { AppEvent } from "./types"

interface StreamHandlers {
  onEvent: (event: AppEvent) => void
  onOpen?: () => void
  onClose?: () => void
}

const INITIAL_RETRY_MS = 1000
const MAX_RETRY_MS = 15000

/**
 * Opens the SSE event stream and delivers parsed events until disposed. We use
 * fetch + ReadableStream rather than the native EventSource because EventSource
 * cannot send the Authorization header the loopback API requires. Drops (server
 * close, network error) reconnect with exponential backoff. Returns a disposer.
 */
export function connectEventStream(handlers: StreamHandlers): () => void {
  const controller = new AbortController()
  let retryMs = INITIAL_RETRY_MS
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  async function run(): Promise<void> {
    const headers = new Headers({ Accept: "text/event-stream" })
    const token = apiToken()
    if (token) headers.set("Authorization", `Bearer ${token}`)

    const response = await fetch("/api/events", { headers, signal: controller.signal })
    // Disposal races the request: the abort has not necessarily landed by the time the
    // fetch resolves, so without this a discarded connection reports itself open and the
    // store reads "open" for a stream nobody is listening to.
    if (disposed) return
    if (!response.ok || !response.body) {
      throw new Error(`event stream failed: ${response.status}`)
    }

    retryMs = INITIAL_RETRY_MS // a healthy connection resets the backoff
    handlers.onOpen?.()

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      // Frames buffered before disposal are not ours to deliver either.
      if (disposed) return
      buffer += value
      // SSE frames are separated by a blank line.
      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = parseFrame(frame)
        if (event) handlers.onEvent(event)
        boundary = buffer.indexOf("\n\n")
      }
    }
  }

  function scheduleReconnect(): void {
    if (disposed) return
    handlers.onClose?.()
    retryTimer = setTimeout(() => void loop(), retryMs)
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
  }

  async function loop(): Promise<void> {
    if (disposed) return
    try {
      await run()
      // The server closed the stream cleanly; treat it as a drop and reconnect.
      scheduleReconnect()
    } catch {
      if (disposed || controller.signal.aborted) return
      scheduleReconnect()
    }
  }

  void loop()

  return () => {
    disposed = true
    if (retryTimer) clearTimeout(retryTimer)
    controller.abort()
  }
}

function parseFrame(frame: string): AppEvent | null {
  let eventType = "message"
  const dataLines: string[] = []
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue // comment / heartbeat
    if (line.startsWith("event:")) eventType = line.slice("event:".length).trim()
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).replace(/^ /, ""))
  }
  if (dataLines.length === 0) return null
  try {
    return { type: eventType, data: JSON.parse(dataLines.join("\n")) as unknown }
  } catch {
    return null
  }
}
