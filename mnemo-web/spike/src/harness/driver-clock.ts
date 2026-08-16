/**
 * The driver's frame clock: waiting for animation frames, driving a gesture for a wall
 * clock duration, and giving up when frames stop arriving at all.
 *
 * Every wait here is watchdogged by a timer, never by the frame clock itself. A rAF chain
 * re-armed only from inside its own callback cannot notice that it stopped being called,
 * and an occluded or backgrounded window (how a headless WebKitGTK run can easily end up)
 * stops delivering frames entirely, so an unwatchdogged wait hangs the whole run instead
 * of reporting the stall it should be reporting.
 *
 * Gestures are driven by elapsed time rather than by a step count. A step count collapses
 * to one frame per step as soon as the requested per-step interval falls under a frame,
 * which is how a "300ms" gesture ends up 14 frames long, and 14 samples make p95, p99 and
 * max the same single observation.
 */

import type { ClockCalibration, FramePhase } from './contract'

/** No animation frame within this long means the frame clock stopped, not that it is slow. */
export const DEFAULT_STALL_TIMEOUT_MS = 2000

/**
 * Names the stall in its message rather than surfacing as a timeout, so a reader of the
 * aborts list can tell "the window stopped compositing" from "the arm was slow".
 */
export class FrameClockStallError extends Error {
  readonly waitedMs: number

  constructor(waitedMs: number) {
    super(
      `frame clock stalled: no animation frame arrived within ${waitedMs}ms, ` +
        'so this run is treated as a hang rather than waited on forever',
    )
    this.name = 'FrameClockStallError'
    this.waitedMs = waitedMs
  }
}

export function requireAnimationFrame(win: Window): void {
  if (typeof win.requestAnimationFrame !== 'function') {
    throw new Error('requestAnimationFrame is unavailable; the driver only runs in a real browser engine')
  }
}

/**
 * The watchdog deliberately uses the ambient timer rather than one taken off `win`: it
 * exists to notice that `win`'s own clock stopped, so sharing a clock with the thing being
 * watched would defeat it.
 */
function armStallWatchdog(timeoutMs: number, onStall: () => void): () => void {
  const handle = setTimeout(onStall, timeoutMs)
  return () => clearTimeout(handle)
}

/** Resolves with the frame's own timestamp, which is the clock every measurement is on. */
export function nextAnimationFrame(
  win: Window = window,
  stallTimeoutMs: number = DEFAULT_STALL_TIMEOUT_MS,
): Promise<number> {
  requireAnimationFrame(win)
  return new Promise((resolve, reject) => {
    let done = false
    const disarm = armStallWatchdog(stallTimeoutMs, () => {
      if (done) return
      done = true
      reject(new FrameClockStallError(stallTimeoutMs))
    })
    win.requestAnimationFrame((t) => {
      if (done) return
      done = true
      disarm()
      resolve(t)
    })
  })
}

/**
 * Awaits `n` real animation-frame ticks. Throws synchronously rather than falling back to
 * a timer when `requestAnimationFrame` is unavailable: the spike only ever measures inside
 * a real browser engine, and silently substituting a different clock is exactly the kind of
 * change that could shift a measurement without anyone noticing.
 */
export function awaitFrames(
  n: number,
  win: Window = window,
  stallTimeoutMs: number = DEFAULT_STALL_TIMEOUT_MS,
): Promise<void> {
  if (n <= 0) return Promise.resolve()
  requireAnimationFrame(win)
  return (async () => {
    for (let i = 0; i < n; i++) await nextAnimationFrame(win, stallTimeoutMs)
  })()
}

// ---- settling ------------------------------------------------------------------------

export interface AwaitSettledOptions {
  readonly win?: Window
  /** Consecutive quiet frames required before the phase counts as settled. */
  readonly windowSize?: number
  /** Multiple of the calibrated median frame time counted as "idle" rather than "still driven". */
  readonly toleranceFactor?: number
  readonly maxWaitMs?: number
  readonly stallTimeoutMs?: number
}

export interface SettleResult {
  readonly settled: boolean
  readonly waitedMs: number
  readonly framesObserved: number
  /** True when frames stopped arriving entirely, which is a different fact from "never quiet". */
  readonly stalled: boolean
}

const DEFAULT_SETTLE_WINDOW = 5
const DEFAULT_SETTLE_TOLERANCE_FACTOR = 1.5
const DEFAULT_SETTLE_MAX_WAIT_MS = 5000

/**
 * Waits until frame deltas return to the calibrated idle baseline, so a settle phase is
 * never cut short while the arm is still catching up from a driven gesture, and never runs
 * forever if it never quiets down. The baseline is the per-run clock calibration, not a
 * hardcoded 16.7ms, because WebKitGTK runs clean 60Hz and 30Hz regimes and a fixed number
 * would read one of them as permanently unsettled.
 *
 * The first callback only seeds the clock. Its delta would measure call-to-first-frame
 * latency, which is almost always inside the idle band, so counting it would let the window
 * close one genuine frame early.
 */
export async function awaitSettled(
  calibration: ClockCalibration,
  options: AwaitSettledOptions = {},
): Promise<SettleResult> {
  const win = options.win ?? window
  const windowSize = options.windowSize ?? DEFAULT_SETTLE_WINDOW
  const toleranceFactor = options.toleranceFactor ?? DEFAULT_SETTLE_TOLERANCE_FACTOR
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_SETTLE_MAX_WAIT_MS
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  const idleCeilingMs = calibration.medianFrameMs * toleranceFactor

  requireAnimationFrame(win)

  const start = performance.now()
  let lastT: number | null = null
  let quietRun = 0
  let framesObserved = 0

  for (;;) {
    let t: number
    try {
      t = await nextAnimationFrame(win, stallTimeoutMs)
    } catch (error) {
      if (error instanceof FrameClockStallError) {
        return {
          settled: false,
          waitedMs: performance.now() - start,
          framesObserved,
          stalled: true,
        }
      }
      throw error
    }

    framesObserved += 1
    const elapsed = t - start

    if (lastT !== null) {
      const dt = t - lastT
      quietRun = dt <= idleCeilingMs ? quietRun + 1 : 0
      if (quietRun >= windowSize) {
        return { settled: true, waitedMs: elapsed, framesObserved, stalled: false }
      }
    }
    lastT = t

    if (elapsed >= maxWaitMs) {
      return { settled: false, waitedMs: elapsed, framesObserved, stalled: false }
    }
  }
}

// ---- duration-driven gesture loop -----------------------------------------------------

export interface FrameProgress {
  /** The frame's own timestamp, on the same clock as `FrameSample.t`. */
  readonly t: number
  readonly elapsedMs: number
  /** 0 at the first frame, 1 at the last, across warmup and driven together. */
  readonly fraction: number
  readonly phase: FramePhase
  readonly frameIndex: number
  /** -1 while still in warmup, so a caller cannot accidentally index driven data with it. */
  readonly drivenFrameIndex: number
}

/**
 * The absolute bounds of what was driven. Absolute because `FrameSample.t` is absolute:
 * a relative time cannot be joined to the frame histogram, and joining them is the whole
 * point of recording a window at all.
 */
export interface DrivenWindow {
  /** The frame that established the clock origin, one frame before the first dispatch. */
  readonly startedAt: number
  readonly drivenStartedAt: number
  readonly endedAt: number
  /** Frames on which an input was dispatched, which is also the dispatch count. */
  readonly frames: number
  readonly drivenFrames: number
}

export interface DriveFramesOptions {
  readonly win: Window
  /** Motion that happens before the measured window opens, so first-frame cost is not measured. */
  readonly warmupMs: number
  readonly durationMs: number
  readonly stallTimeoutMs?: number
  /** Tells the frame sampler which window a frame belongs to. Without it nothing separates them. */
  readonly onPhase?: (phase: FramePhase) => void
  readonly onFrame: (progress: FrameProgress) => void
}

/**
 * Dispatches one input per animation frame until `warmupMs + durationMs` of frame-clock
 * time has passed, and reports the absolute window it drove. Ten seconds of continuous
 * motion is roughly 600 frames at 60Hz and 300 at 30Hz, which is what makes a p95 and a p99
 * different numbers from each other and from max.
 */
export async function driveFrames(options: DriveFramesOptions): Promise<DrivenWindow> {
  const { win, warmupMs, durationMs, onFrame } = options
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  const totalMs = warmupMs + durationMs

  requireAnimationFrame(win)
  options.onPhase?.(warmupMs > 0 ? 'warmup' : 'driven')

  // The first frame only establishes the clock origin. Dispatching on it would send an
  // input at fraction 0, which is a zero-displacement move: the arm has nothing to do with
  // it, so it reads to the drop detector as an input the arm ignored.
  const startedAt = await nextAnimationFrame(win, stallTimeoutMs)
  let t = await nextAnimationFrame(win, stallTimeoutMs)
  let drivenStartedAt = -1
  let frames = 0
  let drivenFrames = 0

  for (;;) {
    const elapsedMs = t - startedAt
    const phase: FramePhase = elapsedMs >= warmupMs ? 'driven' : 'warmup'
    if (phase === 'driven' && drivenStartedAt < 0) {
      drivenStartedAt = t
      if (warmupMs > 0) options.onPhase?.('driven')
    }

    frames += 1
    if (phase === 'driven') drivenFrames += 1

    onFrame({
      t,
      elapsedMs,
      fraction: totalMs <= 0 ? 1 : Math.min(1, elapsedMs / totalMs),
      phase,
      frameIndex: frames - 1,
      drivenFrameIndex: phase === 'driven' ? drivenFrames - 1 : -1,
    })

    if (elapsedMs >= totalMs) break
    t = await nextAnimationFrame(win, stallTimeoutMs)
  }

  return {
    startedAt,
    drivenStartedAt: drivenStartedAt < 0 ? t : drivenStartedAt,
    endedAt: t,
    frames,
    drivenFrames,
  }
}
