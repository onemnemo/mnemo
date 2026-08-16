/**
 * The last moment anything gets to object, and the last moment anything gets to
 * write.
 *
 * Closing the desktop window unmounts nothing, so every "save on the way out"
 * path in the app, a note's autosave flush above all, simply never runs. The
 * web platform has no fix for that on its own: `beforeunload` cannot await a
 * request, and a keepalive one would be posting to a server inside the process
 * that is exiting.
 *
 * So the host asks first. It cancels the close, pushes a `shutdown` event down
 * the event stream, and waits for an answer before closing for real. This module
 * is the middle of that handshake, and it has two halves. Guards may veto the
 * exit; participants save. Whoever holds unsaved state or an objection registers
 * here, and the host is not told to proceed until they have all settled.
 *
 * It is deliberately not aware of notes, or of the exit prompt, or of anything
 * else. The alternative, the event dispatcher reaching into each feature that
 * might have something to save or something to ask, puts a list in the one file
 * that should not have to be edited when a feature is added.
 */

import { apiSend } from "@/api/client"

/**
 * Something to finish before the app may exit. Resolve when the work is done;
 * a rejection is reported and otherwise ignored, since a failed save must not
 * keep the window open.
 */
export type ShutdownParticipant = () => Promise<unknown>

/**
 * Something that may call the exit off. Resolve `false` to keep the window open.
 *
 * Guards run before participants and before anything is saved, because a
 * cancelled exit is not a moment to flush anything: the app carries straight on
 * with the state it had.
 */
export type ShutdownGuard = () => Promise<boolean>

const participants = new Set<ShutdownParticipant>()
const guards = new Set<ShutdownGuard>()

/** Registers a participant. Returns the disposer; call it on unmount. */
export function onShutdown(participant: ShutdownParticipant): () => void {
  participants.add(participant)
  return () => {
    participants.delete(participant)
  }
}

/** Registers a guard. Returns the disposer; call it on unmount. */
export function onShutdownGuard(guard: ShutdownGuard): () => void {
  guards.add(guard)
  return () => {
    guards.delete(guard)
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

/**
 * Asks every guard in turn, stopping at the first objection.
 *
 * In turn rather than concurrently, because guards raise dialogs and the dialog
 * queue serializes them anyway: asked all at once, a veto from the first would
 * still leave the rest of the prompts to dismiss. Fails open, since a guard that
 * throws would otherwise be a window that cannot be closed.
 */
export async function runShutdownGuards(): Promise<boolean> {
  for (const guard of [...guards]) {
    try {
      if (!(await guard())) return false
    } catch (error) {
      console.error("[shutdown] a guard failed; treating it as no objection", error)
    }
  }
  return true
}

let handshake: Promise<void> | null = null

/**
 * Answers the host's `shutdown` event: ask, then save, then say which it was.
 *
 * Memoized, because the host may repeat the request and the second run would
 * report ready before the first had finished saving. The memo is dropped again
 * on a cancelled exit: the window is still open, and the next close has to ask
 * afresh rather than resolve instantly against a gate that has been re-armed.
 */
export function completeShutdown(): Promise<void> {
  handshake ??= negotiate()
  return handshake
}

async function negotiate(): Promise<void> {
  if (guards.size > 0) {
    // Before asking, not after: the host's grace period was measured for a save
    // and will expire out from under anyone reading a dialog.
    await report("/app/shutdown-hold")

    if (!(await runShutdownGuards())) {
      handshake = null
      await report("/app/shutdown-cancel")
      return
    }
  }

  try {
    await runShutdown()
  } finally {
    await report("/app/shutdown-ready")
  }
}

async function report(path: string): Promise<void> {
  try {
    await apiSend(path, { method: "POST" })
  } catch (error) {
    // The host closes on its own deadline regardless, so there is nothing to
    // recover, but a silent failure here would look exactly like a slow save.
    console.error(`[shutdown] could not answer the host at ${path}`, error)
  }
}

/** Test seam: forgets the memoized handshake, every participant and every guard. */
export function resetShutdownForTests(): void {
  handshake = null
  participants.clear()
  guards.clear()
}
