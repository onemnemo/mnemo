/**
 * The last moment anything gets to write.
 *
 * Closing the desktop window unmounts nothing, so every "save on the way out"
 * path in the app, a note's autosave flush above all, simply never runs. The
 * web platform has no fix for that on its own: `beforeunload` cannot await a
 * request, and a keepalive one would be posting to a server inside the process
 * that is exiting.
 *
 * So the host asks first. It cancels the close, pushes a `shutdown` event down
 * the event stream, and waits a few seconds for {@link shutdownReady} before
 * closing for real. This module is the middle of that handshake: whoever holds
 * unsaved state registers here, and the reply is not sent until they have all
 * settled.
 *
 * It is deliberately not aware of notes, or of anything else. The alternative,
 * the event dispatcher reaching into each feature that might have something to
 * save, puts a list in the one file that should not have to be edited when a
 * feature is added.
 */

import { apiSend } from "@/api/client"

/**
 * Something to finish before the app may exit. Resolve when the work is done;
 * a rejection is reported and otherwise ignored, since a failed save must not
 * keep the window open.
 */
export type ShutdownParticipant = () => Promise<unknown>

const participants = new Set<ShutdownParticipant>()

/** Registers a participant. Returns the disposer; call it on unmount. */
export function onShutdown(participant: ShutdownParticipant): () => void {
  participants.add(participant)
  return () => {
    participants.delete(participant)
  }
}

/**
 * Runs every participant concurrently and resolves once they have all settled.
 *
 * Concurrently because the grace period is shared: participants run one after
 * another would spend it queueing rather than saving. Settled rather than
 * resolved because one participant's failure is not a reason to abandon the
 * others' results, nor to leave the host waiting out its full deadline.
 */
export async function runShutdown(): Promise<void> {
  // Snapshotted: a participant registering while this runs has nothing to do
  // with the state being saved, and mutating the set mid-iteration would be a
  // bug rather than a feature.
  const running = [...participants].map(async (participant) => participant())
  const results = await Promise.allSettled(running)
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[shutdown] a participant failed to finish", result.reason)
    }
  }
}

let handshake: Promise<void> | null = null

/**
 * Answers the host's `shutdown` event: save everything, then say so.
 *
 * Memoized, because the host may repeat the request and the second run would
 * report ready before the first had finished saving.
 */
export function completeShutdown(): Promise<void> {
  handshake ??= runShutdown().then(shutdownReady, shutdownReady)
  return handshake
}

async function shutdownReady(): Promise<void> {
  try {
    await apiSend("/app/shutdown-ready", { method: "POST" })
  } catch (error) {
    // The host closes on its own deadline regardless, so there is nothing to
    // recover, but a silent failure here would look exactly like a slow save.
    console.error("[shutdown] could not report ready to the host", error)
  }
}

/** Test seam: forgets the memoized handshake and every participant. */
export function resetShutdownForTests(): void {
  handshake = null
  participants.clear()
}
