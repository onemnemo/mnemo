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
  /**
   * The window is closing and is being held open for us; payload is
   * {@link ShutdownEventData}. Save now, see `@/app/shutdown`.
   */
  Shutdown: "shutdown",
  /**
   * A map committed a change; payload is {@link MindmapChangedEventData}. Whoever has that map open
   * compares the revision against its own and ignores the echo of its own edit. When the notice
   * carries the write whole and the editor is on exactly the revision it applied against, it folds
   * it and gains one undo entry; otherwise it refetches.
   */
  MindmapChanged: "mindmap-changed",
  /**
   * The updater moved; payload is the whole status, see `@/updates/types`. Pushed
   * rather than polled because a download reports progress for as long as it runs,
   * and the window that started it may not be the one watching.
   */
  UpdateStatus: "update-status",
} as const

/** Payload of a `toast` event - mirrors Mnemo.Host/Contracts/ToastEventDto. */
export interface ToastEventData {
  type: "info" | "success" | "warning" | "action" | "task"
  title: string
  description?: string | null
  durationMs: number
}

/**
 * Payload of a `mindmap-changed` event - mirrors Mnemo.Host/Mindmap/MindmapChangeBridge.cs.
 *
 * It also carries the write itself, as a delta pair plus the document order, so a change nobody in
 * the editor made can still be taken back with one Ctrl+Z. Those fields are shaped by the mindmap
 * module and read there (see its `MindmapChangedNotice`); they are left out of this declaration so
 * the events layer does not have to know the mindmap document model. They are omitted from the wire
 * too when the change was too big to be worth pushing down a channel every module shares, and the
 * client refetches instead.
 */
export interface MindmapChangedEventData {
  mapId: string
  revision: number
  baseRevision: number
  kind: "created" | "edited" | "renamed" | "deleted"
}

/** Payload of a `shutdown` event - mirrors the grace period Mnemo.Host waits out. */
export interface ShutdownEventData {
  /** How long the host will wait before closing whether or not we answer. */
  graceMs: number
}

export type ConnectionStatus = "connecting" | "open" | "closed"
