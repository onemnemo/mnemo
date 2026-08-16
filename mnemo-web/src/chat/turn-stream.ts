import { ApiError, apiToken } from "@/api/client"

import type { ChatToolEvent, ChatTurnRequest, TurnEvent } from "./types"

// The assistant turn stream. POST /api/chat/conversations/{id}/turns runs one
// agentic turn and streams six typed SSE signals. We use fetch + ReadableStream
// (not EventSource) because the request carries a JSON body and the loopback API
// requires the Authorization header EventSource cannot send.

interface StreamTurnOptions {
  onEvent: (event: TurnEvent) => void
  /** Aborts the fetch (hard client disconnect, e.g. unmount). For a user "stop", call cancelTurn instead. */
  signal?: AbortSignal
}

/**
 * Runs one turn to completion, delivering each parsed event to `onEvent`.
 * Resolves when the stream ends (a `done` or `error` event, or a clean close).
 * Rejects only on a transport/HTTP failure before the stream opens; in-band AI
 * failures arrive as an `error` event, not a rejection.
 */
export async function streamTurn(
  conversationId: string,
  request: ChatTurnRequest,
  { onEvent, signal }: StreamTurnOptions,
): Promise<void> {
  const headers = new Headers({
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  })
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok || !response.body) {
    throw await readHttpError(response)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    // SSE frames are separated by a blank line.
    let boundary = buffer.indexOf("\n\n")
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = parseTurnFrame(frame)
      if (event) onEvent(event)
      boundary = buffer.indexOf("\n\n")
    }
  }
}

/**
 * Asks the server to stop a running turn. Graceful: the turn ends with a `done`
 * event carrying stopped:true and whatever it produced so far (matching the
 * desktop "stop" button). Keyed on the client-minted turnId. A 404 (turn already
 * finished) is swallowed, the stream is about to end on its own.
 */
export async function cancelTurn(turnId: string): Promise<void> {
  const headers = new Headers()
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(`/api/chat/turns/${encodeURIComponent(turnId)}/cancel`, {
    method: "POST",
    headers,
  })
  if (!response.ok && response.status !== 404) {
    throw await readHttpError(response)
  }
}

async function readHttpError(response: Response): Promise<ApiError> {
  let code: string | undefined
  let message: string | undefined
  try {
    const body = (await response.json()) as { error?: string; message?: string }
    code = body.error
    message = body.message ?? body.error
  } catch {
    // Non-JSON error body, fall back to the status line.
  }
  return new ApiError(message ?? response.statusText ?? `Turn failed (${response.status})`, response.status, code)
}

/** Parses one SSE frame into a typed turn event, or null when the frame is a comment/heartbeat or malformed. */
function parseTurnFrame(frame: string): TurnEvent | null {
  let eventType = "message"
  const dataLines: string[] = []
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue // comment / heartbeat
    if (line.startsWith("event:")) eventType = line.slice("event:".length).trim()
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).replace(/^ /, ""))
  }
  if (dataLines.length === 0) return null

  let data: unknown
  try {
    data = JSON.parse(dataLines.join("\n"))
  } catch {
    return null
  }

  return coerceTurnEvent(eventType, data)
}

/** Trusts the server's event vocabulary; unknown event names are dropped. */
function coerceTurnEvent(type: string, data: unknown): TurnEvent | null {
  switch (type) {
    case "status":
      return { type, data: data as { key: string } }
    case "tool":
      return { type, data: data as ChatToolEvent }
    case "reasoning":
      return { type, data: data as { text: string } }
    case "narration":
      return { type, data: data as { text: string } }
    case "delta":
      return { type, data: data as { text: string } }
    case "done":
      return {
        type,
        data: data as { foundResponse: boolean; content: string; stopped: boolean; failureKind?: string | null },
      }
    case "error":
      return { type, data: data as { kind: string; message: string } }
    default:
      return null
  }
}
