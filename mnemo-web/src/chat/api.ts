import { apiFetch, apiSend } from "@/api/client"

import type {
  AssistantMode,
  AssistantModeResult,
  ChatAsset,
  ChatConversation,
  ChatConversationSummary,
} from "./types"

// Per-conversation REST over the single stored chat-history document. The Host
// owns the read-modify-write; the SPA only ever sees resolved resources. A
// conversation is ephemeral until its first turn, so there is no "create" call —
// the turn stream materializes it (see turn-stream.ts).

export function fetchConversations(): Promise<ChatConversationSummary[]> {
  return apiFetch<ChatConversationSummary[]>("/chat/conversations")
}

export function fetchConversation(id: string): Promise<ChatConversation> {
  return apiFetch<ChatConversation>(`/chat/conversations/${encodeURIComponent(id)}`)
}

/** Renames a conversation. An empty/blank title clears the override (title falls back to the first message). */
export function renameConversation(id: string, title: string): Promise<ChatConversationSummary> {
  return apiFetch<ChatConversationSummary>(`/chat/conversations/${encodeURIComponent(id)}/title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: title }),
  })
}

/**
 * Persists a response-length change made without sending a turn. The turn stream
 * stamps the mode on every completed turn; this covers switching then navigating
 * away. The server normalizes and echoes the stored mode back.
 */
export function setConversationMode(id: string, mode: AssistantMode): Promise<AssistantModeResult> {
  return apiFetch<AssistantModeResult>(`/chat/conversations/${encodeURIComponent(id)}/mode`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: mode }),
  })
}

/**
 * Sets reader feedback on an assistant message, keyed by its position in the
 * conversation: 0 none, 1 up, 2 down. Messages are positional server-side, so the
 * index is the same one the SPA rendered from the conversation DTO.
 */
export function setMessageFeedback(id: string, index: number, value: number): Promise<{ value: number }> {
  return apiFetch<{ value: number }>(`/chat/conversations/${encodeURIComponent(id)}/messages/${index}/feedback`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  })
}

export function deleteConversation(id: string): Promise<void> {
  return apiSend(`/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/** Clears all chat history (every conversation). */
export function clearChatHistory(): Promise<void> {
  return apiSend("/chat/history", { method: "DELETE" })
}

/**
 * Uploads one file as a chat asset and returns its reference. The browser sets the
 * multipart Content-Type (with boundary) itself, so we pass FormData without a header.
 */
export function uploadChatAsset(file: File): Promise<ChatAsset> {
  const body = new FormData()
  body.append("file", file)
  return apiFetch<ChatAsset>("/chat/assets", { method: "POST", body })
}
