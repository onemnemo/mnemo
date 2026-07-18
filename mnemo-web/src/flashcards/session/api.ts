import { ApiError, apiFetch, apiSend, apiToken } from "@/api/client"
import type { CardDto, GradeCardDto, StartStudySessionDto, StudySessionDto } from "@/api/types"

// The session lives on the server and every call answers with its whole state, so these are
// plain functions rather than react-query hooks: there is nothing to cache. The store drives
// them and holds the one payload the screen renders from.

const BASE = "/study/sessions"

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}

export function startSession(body: StartStudySessionDto): Promise<StudySessionDto> {
  return apiFetch<StudySessionDto>(BASE, json(body))
}

export function getSession(sessionId: string): Promise<StudySessionDto> {
  return apiFetch<StudySessionDto>(`${BASE}/${encodeURIComponent(sessionId)}`)
}

/**
 * Grades the card the screen is showing. A 409 means the server had moved on - a double-tapped
 * button, or a retry of a grade that already landed - and its body is the session's real state,
 * so it is a successful answer here rather than an error. {@link apiFetch} discards error bodies,
 * hence the hand-rolled request.
 */
export async function gradeCard(sessionId: string, body: GradeCardDto): Promise<StudySessionDto> {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json" })
  const token = apiToken()
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  const response = await fetch(`/api${BASE}/${encodeURIComponent(sessionId)}/grade`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  if (response.ok || response.status === 409) {
    const data: unknown = await response.json()
    return data as StudySessionDto
  }

  throw new ApiError(response.statusText, response.status)
}

export function undoGrade(sessionId: string): Promise<StudySessionDto> {
  return apiFetch<StudySessionDto>(`${BASE}/${encodeURIComponent(sessionId)}/undo`, { method: "POST" })
}

/** Ends a session so its study is recorded. Idempotent server-side, so a duplicate is harmless. */
export function endSession(sessionId: string): Promise<void> {
  return apiSend(`${BASE}/${encodeURIComponent(sessionId)}`, { method: "DELETE" })
}

/**
 * Re-reads a card the reader has just edited. The session's copy was captured when the queue was
 * built and will not change, so the screen has to fetch the new text itself.
 */
export function fetchCard(cardId: string): Promise<CardDto> {
  return apiFetch<CardDto>(`/cards/${encodeURIComponent(cardId)}`)
}
