import { apiFetch, apiSend } from "@/api/client"
import type { RecordTestActivityDto, RecordTestAttemptDto, TestQueueDto, TestResultDto } from "@/api/types"

// Test keeps no state on the server, so there is nothing to cache and nothing to poll: the queue
// is fetched once and the two writes are one-way. Plain functions, driven by the store.

function deckPath(deckId: string, suffix: string): string {
  return `/decks/${encodeURIComponent(deckId)}/${suffix}`
}

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}

/** The deck's active cards, in due order or shuffled per the deck's preset. */
export function fetchTestQueue(deckId: string): Promise<TestQueueDto> {
  return apiFetch<TestQueueDto>(deckPath(deckId, "test-queue"))
}

/** Records a finished attempt and answers with the score, the delta, the best and the trend. */
export function recordAttempt(deckId: string, body: RecordTestAttemptDto): Promise<TestResultDto> {
  return apiFetch<TestResultDto>(deckPath(deckId, "test-attempts"), post(body))
}

/**
 * Records the effort, whether or not the test was finished. Separate from the attempt because
 * leaving halfway still counts as study time - it just has no score.
 */
export function recordActivity(deckId: string, body: RecordTestActivityDto): Promise<void> {
  return apiSend(deckPath(deckId, "test-activity"), post(body))
}
