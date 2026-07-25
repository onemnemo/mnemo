/**
 * Environment facts and confounder checks for the spike.
 *
 * A measurement taken under the wrong conditions, a dev build, a StrictMode double-render, a
 * resized window, is not a smaller version of the real number, it is a different experiment.
 * This module turns those conditions into checkable facts the runner can assert on, rather
 * than something it silently assumes.
 */

import type { EnvironmentFacts } from './contract'
import { awaitStrictModeDetection } from './strict-mode-detection'

const REQUIRED_VIEWPORT_WIDTH = 1600
const REQUIRED_VIEWPORT_HEIGHT = 900

// ---- Feature reads ------------------------------------------------------------------

function readSupportedEntryTypes(): readonly string[] {
  if (typeof PerformanceObserver === 'undefined') return []
  return PerformanceObserver.supportedEntryTypes ?? []
}

/**
 * Reads the active rasterizer off a throwaway WebGL context via WEBGL_debug_renderer_info,
 * feature-detected at every step so an engine or a privacy setting that blocks the extension
 * reports `null` instead of throwing. The context is explicitly lost before returning so the
 * probe does not hold a GPU context alive for the rest of the run.
 */
function readRasterizer(): string | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  if (!gl) return null
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return null
    const renderer: unknown = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
    return typeof renderer === 'string' ? renderer : null
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

function readContentVisibilitySupport(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('content-visibility', 'auto')
  )
}

/** Chromium-only, absent everywhere else. See `EnvironmentFacts.heapUsedBytes`: never load-bearing. */
interface ChromePerformanceMemory {
  readonly usedJSHeapSize: number
}

function readHeapUsedBytes(perf: Performance): number | null {
  const memory = (perf as Performance & { memory?: ChromePerformanceMemory }).memory
  const used = memory?.usedJSHeapSize
  return typeof used === 'number' ? used : null
}

function readViewportSize(): { readonly width: number; readonly height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

// ---- Capture --------------------------------------------------------------------------

export interface CaptureEnvironmentOptions {
  /** Bound on how long to wait for `StrictModeProbe` before the read becomes 'inconclusive'. */
  readonly strictModeTimeoutMs?: number
}

/**
 * Async because a real StrictMode read requires waiting on `StrictModeProbe`, mounted
 * elsewhere in the live tree, to report back; there is no synchronous way to ask React
 * whether an ancestor is StrictMode-wrapped.
 */
export async function captureEnvironment(
  options: CaptureEnvironmentOptions = {},
): Promise<EnvironmentFacts> {
  const strictModeDetected = await awaitStrictModeDetection(options.strictModeTimeoutMs)
  const supportedEntryTypes = readSupportedEntryTypes()
  const { width, height } = readViewportSize()

  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: width,
    viewportHeight: height,
    isProductionBuild: import.meta.env.PROD,
    strictModeDetected,
    eventTimingAvailable: supportedEntryTypes.includes('event'),
    supportedEntryTypes,
    rasterizer: readRasterizer(),
    contentVisibilitySupported: readContentVisibilitySupport(),
    heapUsedBytes: readHeapUsedBytes(performance),
  }
}

// ---- Confounders ------------------------------------------------------------------------

/** Empty means clean. Every entry here is a reason a run must not be reported as a measurement. */
export function assertConfounders(env: EnvironmentFacts): string[] {
  const violations: string[] = []

  if (!env.isProductionBuild) {
    violations.push('not a production build: import.meta.env.PROD is false')
  }
  if (env.strictModeDetected === true) {
    violations.push('React StrictMode is active, effects and renders are double-invoked')
  }
  // An unverified StrictMode is the confounder this check exists for, so an inconclusive read
  // is treated exactly like a positive one. The only clean state is a probe that reported.
  if (env.strictModeDetected === 'inconclusive') {
    violations.push(
      'StrictMode could not be verified: StrictModeProbe never reported, so this run cannot ' +
        'be claimed to be free of double-invoked renders',
    )
  }
  if (env.viewportWidth !== REQUIRED_VIEWPORT_WIDTH || env.viewportHeight !== REQUIRED_VIEWPORT_HEIGHT) {
    violations.push(
      `viewport is ${env.viewportWidth}x${env.viewportHeight}, expected exactly ` +
        `${REQUIRED_VIEWPORT_WIDTH}x${REQUIRED_VIEWPORT_HEIGHT} CSS px`,
    )
  }
  // Event Timing is deliberately NOT a confounder. It only reports user-agent-generated events
  // and every event here is synthetic, so no gating metric can depend on it; its availability is
  // recorded in EnvironmentFacts as corroboration and its absence must never invalidate a run.

  return violations
}

// ---- Visibility watchdog ----------------------------------------------------------------

/**
 * Watches for the window leaving 'visible', by event and by poll, so a host that does not
 * fire `visibilitychange` reliably still gets caught within one poll interval rather than
 * running an entire scenario blind. A backgrounded or minimized window is throttled by the
 * OS and the compositor, and frame timing collected while that is true is fiction, not a
 * slow measurement.
 *
 * Returns a disposer. `onLost` may fire more than once while the window stays hidden;
 * callers that want a single abort should call the disposer from inside `onLost`.
 */
export function watchVisibility(
  onLost: (state: DocumentVisibilityState) => void,
  pollIntervalMs = 250,
): () => void {
  let stopped = false

  function check(): void {
    if (stopped) return
    if (document.visibilityState !== 'visible') {
      onLost(document.visibilityState)
    }
  }

  document.addEventListener('visibilitychange', check)
  const intervalId = setInterval(check, pollIntervalMs)

  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', check)
    clearInterval(intervalId)
  }
}
