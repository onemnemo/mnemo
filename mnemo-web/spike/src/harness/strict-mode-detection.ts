/**
 * One-shot state for StrictMode detection, written by `StrictModeProbe` and read by
 * `captureEnvironment`. Split out from the probe component itself so this file exports only
 * plain functions and the probe file exports only the component, which keeps both easy to
 * unit test and keeps the component file free of unrelated exports.
 */

import type { StrictModeDetection } from './contract'

let result: boolean | undefined
let waiters: Array<(detected: boolean) => void> = []

/** Called by `StrictModeProbe` once it has an answer. Later calls are no-ops, the probe is one-shot. */
export function resolveStrictModeDetection(detected: boolean): void {
  if (result !== undefined) return
  result = detected
  const pending = waiters
  waiters = []
  for (const waiter of pending) waiter(detected)
}

/**
 * Resolves once `resolveStrictModeDetection` has been called, or after `timeoutMs` with
 * 'inconclusive'.
 *
 * The timeout path reports 'inconclusive' rather than false because it is not an observation.
 * The probe can be unmounted, mount late, or be starved by the very mount work S1 measures, and
 * a 5000-element mount is exactly the case where a 500ms timer wins the race. Resolving false
 * there would hand the caller a verified negative it never had, and a StrictMode build, every
 * render and effect double-invoked, would be recorded as a clean measurement.
 */
export function awaitStrictModeDetection(timeoutMs = 500): Promise<StrictModeDetection> {
  if (result !== undefined) {
    return Promise.resolve(result)
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(
        '[spike] StrictModeProbe never reported within the timeout; strictModeDetected is ' +
          "'inconclusive' and the run cannot be treated as StrictMode-free.",
      )
      resolve('inconclusive')
    }, timeoutMs)
    waiters.push((detected) => {
      clearTimeout(timer)
      resolve(detected)
    })
  })
}

/** Test-only: clears the one-shot state between cases. */
export function resetStrictModeDetectionForTests(): void {
  result = undefined
  waiters = []
}
