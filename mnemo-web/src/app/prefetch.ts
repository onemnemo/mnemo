/**
 * Fetches the code this launch is most likely to want next, while nothing else needs the
 * main thread.
 *
 * Every module except Overview is loaded on demand (see app/routes), which is what keeps
 * the entry chunk small enough to paint quickly. The cost is that a window resuming on a
 * flashcards deck shows the shell and then waits on a download. This closes that gap from
 * the other end: the download starts during the first idle period, so it overlaps the rest
 * of the boot instead of following it.
 *
 * Nothing here is load-bearing. A warm that never happens costs a spinner someone would
 * have seen anyway, and a warm that loses the race merges with the load the route starts
 * for itself, because both sides are the same dynamic import.
 */

import { readLastRoute } from "@/app/router"
import { warmRoute } from "@/app/routes"
import { readLastNoteId } from "@/notes/workspace/session"

/**
 * How long to let the main thread stay busy before warming anyway.
 *
 * Long enough that the warm-up loses to the shell's own work on a slow machine, short
 * enough that it still lands before someone has finished reading the page they arrived on.
 */
const IDLE_GRACE_MS = 2000

/** Schedules the warm-up and returns a function that calls it off. */
type Schedule = (run: () => void) => () => void

const whenIdle: Schedule = (run) => {
  // requestIdleCallback is the right instrument and is a platform API, not a dependency,
  // but it is still missing often enough to need an answer. A plain timer is a worse
  // approximation of "quiet", not a broken one.
  if (typeof requestIdleCallback !== "function") {
    const timer = setTimeout(run, IDLE_GRACE_MS)
    return () => clearTimeout(timer)
  }

  const handle = requestIdleCallback(run, { timeout: IDLE_GRACE_MS })
  return () => cancelIdleCallback(handle)
}

const never: Schedule = () => () => {}

/**
 * Off by default under test. A suite that mounts the shell has no business fetching every
 * chunk the profile might want, and nothing in jsdom would be waiting on the results. Tests
 * that mean to exercise the warm-up pass a scheduler of their own.
 */
const DEFAULT_SCHEDULE: Schedule = import.meta.env.MODE === "test" ? never : whenIdle

/** The routes worth having in hand, given what the last session left behind. */
function warmLikelyRoutes(): void {
  const lastRoute = readLastRoute()
  if (lastRoute) warmRoute(lastRoute)

  // A remembered note means this profile is one that uses notes, and the notes chunk is by
  // far the largest of them, so it is the one most worth holding before it is asked for.
  // The workspace reopens that note on arrival, which is the moment the wait would show.
  if (readLastNoteId()) warmRoute("#/notes")
}

/** Starts the warm-up. Returns a function that cancels it if it has not run yet. */
export function startRoutePrefetch(schedule: Schedule = DEFAULT_SCHEDULE): () => void {
  return schedule(warmLikelyRoutes)
}
