/**
 * A place for a module to hear a server push that only it can act on.
 *
 * The dispatcher handles events whose meaning is app-wide (a toast, a shutdown) and can therefore be
 * decided from the payload alone. A mindmap change notice is not like that: whether it means
 * anything depends on which map is open, what the editor already knows, and whether the editor is
 * mid-write. Only the editor can answer that, and it exists for a page's lifetime rather than the
 * app's, so it subscribes and unsubscribes rather than being reached from a switch statement.
 */

import type { AppEvent } from "./types"

type Subscriber = (event: AppEvent) => void

const byType = new Map<string, Set<Subscriber>>()

/** Subscribes to one event type. Returns the unsubscribe. */
export function onAppEvent(type: string, subscriber: Subscriber): () => void {
  const existing = byType.get(type) ?? new Set<Subscriber>()
  existing.add(subscriber)
  byType.set(type, existing)

  return () => {
    const current = byType.get(type)
    if (!current) {
      return
    }
    current.delete(subscriber)
    if (current.size === 0) {
      byType.delete(type)
    }
  }
}

/** Called by the dispatcher for every event, after its own handling. */
export function notifySubscribers(event: AppEvent): void {
  const subscribers = byType.get(event.type)
  if (!subscribers) {
    return
  }

  // Copied before iterating: a subscriber that unsubscribes itself in response is a normal thing
  // for a page teardown to do, and mutating the set mid-iteration would skip its neighbour.
  for (const subscriber of [...subscribers]) {
    subscriber(event)
  }
}

/** Test seam: drops every subscription, so one test's listener cannot outlive it. */
export function resetSubscribersForTests(): void {
  byType.clear()
}
