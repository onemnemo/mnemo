/**
 * Coordinates native window shutdown: guards may veto, then participants finish saving before the
 * host closes. Separate synchronous probes report unsaved work for browser reloads.
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

/**
 * Reports whether this source has unsaved work. Must be synchronous because beforeunload cannot
 * await a save.
 */
export type DirtyProbe = () => boolean

const participants = new Set<ShutdownParticipant>()
const guards = new Set<ShutdownGuard>()
const probes = new Set<DirtyProbe>()

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

/** Registers a dirty probe. Returns the disposer; call it on unmount. */
export function onDirtyCheck(probe: DirtyProbe): () => void {
  probes.add(probe)
  return () => {
    probes.delete(probe)
  }
}

/**
 * Checks registered probes for unsaved work. A throwing probe counts as dirty so an error cannot
 * suppress the leave-page warning.
 */
export function isAnythingDirty(): boolean {
  for (const probe of [...probes]) {
    try {
      if (probe()) return true
    } catch (error) {
      console.error("[shutdown] a dirty probe failed; treating it as unsaved", error)
      return true
    }
  }
  return false
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

/**
 * How long participants get once the clock has been held.
 *
 * The host's grace period is generous for the case it was measured on, one
 * commit against a local file. This is the ceiling for the cases it was not: a
 * document large enough to be slow to serialize, or a save already in flight
 * that has to finish before the final one can start. Bounded rather than open
 * ended, because unlike a prompt there is nobody waiting to answer a request
 * that hangs, and an unbounded wait is a window that will not close.
 */
const participantDeadlineMs = 10_000

async function negotiate(): Promise<void> {
  // Held for saving as much as for asking. The host's grace period starts before
  // the SPA has serialized anything, so the note big enough to be slow to write
  // is exactly the note whose write gets cut off half way through.
  if (guards.size > 0 || participants.size > 0) {
    // Before either, not after: the period will otherwise expire out from under
    // whoever is reading a dialog or waiting on a commit.
    await report("/app/shutdown-hold")
  }

  if (!(await runShutdownGuards())) {
    handshake = null
    await report("/app/shutdown-cancel")
    return
  }

  try {
    await withDeadline(runShutdown(), participantDeadlineMs)
  } finally {
    await report("/app/shutdown-ready")
  }
}

/** Resolves when the work settles or the deadline passes, whichever is first. */
async function withDeadline(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => {
      resolve("expired")
    }, ms)
  })

  try {
    const first = await Promise.race([work.then(() => "done" as const), expiry])
    if (first === "expired") {
      console.error(`[shutdown] gave up waiting for a participant after ${String(ms)}ms`)
    }
  } finally {
    clearTimeout(timer)
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

/** Test seam: forgets the memoized handshake and everything registered. */
export function resetShutdownForTests(): void {
  handshake = null
  participants.clear()
  guards.clear()
  probes.clear()
}
