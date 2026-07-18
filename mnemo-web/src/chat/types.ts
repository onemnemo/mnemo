// Hand-mirrors the C# chat contracts in Mnemo.Host/Contracts (ChatDto.cs,
// ChatTurnDto.cs). The C# side is authoritative; field names are the camelCase
// forms the minimal API emits. Kept in the chat slice so the whole Atlas surface
// reads from one type home.

/** Response-length mode, per conversation. Normalized server-side; legacy ids fold to these three. */
export type AssistantMode = "Short" | "Normal" | "Detailed"

export const ASSISTANT_MODES: readonly AssistantMode[] = ["Short", "Normal", "Detailed"]

/** One row in the conversations sidebar. `title` null means "no title yet" (render the localized New chat label). */
export interface ChatConversationSummary {
  id: string
  title: string | null
  lastActivityUtc: string
}

/** A full conversation with its messages, loaded when a thread is opened. */
export interface ChatConversation {
  id: string
  title: string | null
  customTitle: string | null
  lastActivityUtc: string
  assistantMode: AssistantMode
  messages: ChatMessage[]
}

/** One tool invocation shown under a process step. */
export interface ChatToolCall {
  name: string
  arguments: string
  result: string
  summary: string
}

/** One row in the assistant's process trace (routing, model, a tool call, or narration). */
export interface ChatProcessStep {
  label: string
  detail: string | null
  narration: string | null
  phaseKind: string
  isComplete: boolean
  toolCalls: ChatToolCall[] | null
}

/** A message attachment as the browser sees it: kind + display name only (no local path crosses the wire). */
export interface ChatAttachment {
  kind: "image" | "file"
  displayName: string | null
}

/** A persisted chat bubble. Mirrors ChatMessageDto. */
export interface ChatMessage {
  content: string
  isUser: boolean
  timestampUtc: string
  suggestions: string[] | null
  sources: string[] | null
  attachments: ChatAttachment[] | null
  thoughts: string | null
  thoughtsCount: number
  processHeaderText: string | null
  elapsedText: string | null
  processSummaryText: string | null
  processThreadExpanded: boolean | null
  feedback: number
  processSteps: ChatProcessStep[] | null
}

/** The conversation's mode after normalization, returned by PUT .../mode. */
export interface AssistantModeResult {
  mode: AssistantMode
}

// --- Turn stream ------------------------------------------------------------

/** Body of POST /api/chat/conversations/{id}/turns. The client mints turnId (used to cancel). */
export interface ChatTurnRequest {
  turnId: string
  message: string
  assistantMode: AssistantMode | null
}

/** Stage of a tool call as it crosses the turn stream; a call arrives running then terminal, correlated by id. */
export type ChatToolStage = "running" | "completed" | "failed"

/** A tool-call lifecycle event on the turn stream (mirrors ChatToolEventDto). */
export interface ChatToolEvent {
  id: string
  name: string
  arguments: string | null
  result: string | null
  stage: ChatToolStage
}

/**
 * The six typed SSE signals the turn endpoint streams, as a discriminated union
 * keyed on the SSE event name. Reveal pacing is dropped server-side, so `delta`
 * carries raw tokens the moment the model produces them.
 */
export type TurnEvent =
  | { type: "status"; data: { key: string } }
  | { type: "tool"; data: ChatToolEvent }
  | { type: "reasoning"; data: { text: string } }
  | { type: "narration"; data: { text: string } }
  | { type: "delta"; data: { text: string } }
  | { type: "done"; data: { foundResponse: boolean; content: string; stopped: boolean } }
  | { type: "error"; data: { kind: string; message: string } }

/**
 * The AI error vocabulary shared by the turn stream's `error` event and the
 * key-validation result. Snake_case, mirrors AiClientErrorKind → wire in
 * Mnemo.Host/Ai/AiErrorMapping. `unknown` is the catch-all.
 */
export type AiErrorKind =
  | "invalid_api_key"
  | "insufficient_credits"
  | "rate_limited"
  | "model_unavailable"
  | "network"
  | "timeout"
  | "invalid_request"
  | "unknown"

// --- Client-only view state (never crosses the wire) ------------------------

/**
 * How an inline failure renders. `missing_api_key` gets the Settings deep-link;
 * the other two get a Retry action. Mirrors the desktop's ChatNoticeKind.
 */
export type ChatNoticeKind = "missing_api_key" | "model_unavailable" | "error"

/** An inline failure notice replacing a failed assistant turn. Never persisted. */
export interface ChatTurnNotice {
  kind: ChatNoticeKind
  text: string
}

/**
 * A message as the SPA renders it: the persisted shape plus transient turn state.
 * `streaming` marks the assistant placeholder while tokens arrive; `notice`
 * replaces a failed turn's body. Both are dropped once the turn resolves to the
 * server's canonical persisted message.
 */
export interface ChatMessageView extends ChatMessage {
  streaming?: boolean
  notice?: ChatTurnNotice | null
}
