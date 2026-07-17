// The app-events channel: server-to-client pushes over SSE (GET /api/events).
// Kept transport-agnostic - see sse-client.ts for how frames are read and
// dispatch.ts for how each event type maps to app state.

/** One server push. `type` is the SSE event name; `data` is the parsed payload. */
export interface AppEvent<T = unknown> {
  type: string
  data: T
}

/** Event names the server emits. Keep in sync with Mnemo.Host's AppEvent producers. */
export const EventType = {
  /** Connection handshake sent once on connect. */
  Hello: "hello",
  /** A toast raised server-side; payload is {@link ToastEventData}. */
  Toast: "toast",
} as const

/** Payload of a `toast` event - mirrors Mnemo.Host/Contracts/ToastEventDto. */
export interface ToastEventData {
  type: "info" | "success" | "warning" | "action" | "task"
  title: string
  description?: string | null
  durationMs: number
}

export type ConnectionStatus = "connecting" | "open" | "closed"
