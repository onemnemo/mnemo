/**
 * React scopes StrictMode's double-invoke behaviour to the component tree it wraps. A probe
 * mounted through its own, separate `createRoot` call sits in an unrelated tree and can
 * never observe an ancestor's StrictMode no matter how it's written, so this component is
 * meant to be rendered inside the actual tree under measurement, as close to its root as
 * practical, not run in isolation by `captureEnvironment` itself.
 *
 * The heuristic: in development, StrictMode synchronously mounts, unmounts and remounts
 * every effect once before paint. Counting effect runs on a ref and reading the count back
 * after a frame plus a microtask observes that from userland; there is no public API for it.
 * A false negative is possible if this is ever mounted outside the app's StrictMode
 * boundary, and nothing in this module can detect that misconfiguration from the inside, so
 * the result is a heuristic, never a certainty.
 */

import { useEffect, useRef } from 'react'

import { resolveStrictModeDetection } from './strict-mode-detection'

/** Mount once, near the real app root, before awaiting `awaitStrictModeDetection`. */
export function StrictModeProbe(): null {
  const runCount = useRef(0)

  useEffect(() => {
    runCount.current += 1
    // StrictMode's synthetic unmount/remount happens synchronously within the same commit,
    // well before the next frame, so a frame plus a microtask is a generous margin rather
    // than a race against it.
    const rafId = requestAnimationFrame(() => {
      queueMicrotask(() => resolveStrictModeDetection(runCount.current >= 2))
    })
    return () => cancelAnimationFrame(rafId)
  }, [])

  return null
}
