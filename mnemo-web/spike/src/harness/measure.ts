/**
 * Frame-cadence and input-latency measurement primitives.
 *
 * Everything here is a pure reader over already-collected samples except the pieces that must
 * touch the platform clock directly: the rAF sampler, the dispatch-latency probe and the Event
 * Timing wrapper. Keeping those small and separate from the statistics means a bug in "how do
 * we compute p95" can never also be a bug in "did we record the right timestamp".
 */

import type {
  ClockCalibration,
  FramePhase,
  FrameSample,
  FrameStats,
  LatencyStats,
} from './contract'

// ---- Frame sampling ---------------------------------------------------------------------

export interface FrameSampler {
  /**
   * Begins the rAF chain, discarding whatever a previous cycle left behind. Throws if already
   * running: a double-start is a driver bug.
   */
  start(): void
  /** Stops the rAF chain. Safe to call whether or not the sampler is currently running. */
  stop(): void
  /** Tags every subsequently recorded sample, until the next call, with `phase`. */
  setPhase(phase: FramePhase): void
  /** Every sample recorded so far, across every phase, in recording order. */
  collect(): readonly FrameSample[]
  /** Drops every sample and returns the phase to 'warmup', without touching the rAF chain. */
  reset(): void
}

/**
 * A requestAnimationFrame delta sampler. The driver owns the meaning of "now": it calls
 * `setPhase` as a gesture moves from the discard window into the driven motion and then into
 * settle, and every delta recorded in between carries whichever phase was current when that
 * frame landed.
 *
 * A cycle owns its own samples: `start` clears them. Reusing one sampler across two scenarios
 * would otherwise pool both runs' driven frames into a single distribution, and `count` would
 * give the caller no hint that the run boundary had been crossed.
 */
export function createFrameSampler(): FrameSampler {
  const samples: FrameSample[] = []
  let phase: FramePhase = 'warmup'
  let lastFrameT: number | null = null
  let rafId: number | null = null
  let running = false

  function tick(t: DOMHighResTimeStamp): void {
    if (!running) return
    // The first callback only establishes the clock origin; a delta needs two points.
    if (lastFrameT !== null) {
      samples.push({ t, dt: t - lastFrameT, phase })
    }
    lastFrameT = t
    rafId = requestAnimationFrame(tick)
  }

  function discard(): void {
    samples.length = 0
    phase = 'warmup'
    // Dropped too, so the first delta after a clear is never measured across the boundary.
    lastFrameT = null
  }

  return {
    start() {
      if (running) {
        throw new Error('FrameSampler.start called while already running')
      }
      // Phase goes back to 'warmup' with the samples: a phase surviving into the next cycle
      // would tag this run's opening frames 'settle', and no later setPhase would un-tag them.
      // A caller that wants the first frames driven calls setPhase after start.
      discard()
      running = true
      rafId = requestAnimationFrame(tick)
    },
    stop() {
      running = false
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    },
    setPhase(next) {
      phase = next
    },
    collect() {
      return samples.slice()
    },
    reset() {
      discard()
    },
  }
}

// ---- Statistics -------------------------------------------------------------------------

/**
 * Below this many samples the nearest-rank tail ranks stop being distinct: for n < 20,
 * ceil(0.95 * n) === n, and for n <= 100, ceil(0.99 * n) === n, so p95 and p99 are literally
 * `max` and the three columns print one observation three times. 200 driven frames is roughly
 * 10 seconds of continuous motion at 60Hz, which keeps the tail ranks apart and is what every
 * gating gesture is required to collect.
 */
export const MIN_FRAMES_FOR_STABLE_PERCENTILES = 200

/**
 * Nearest-rank percentile over an already sorted-ascending array. Deliberately not
 * interpolated: nearest-rank always names an observation that actually happened, which
 * matters when someone wants to go find that exact frame in a trace afterward.
 */
function nearestRank(sortedAscending: readonly number[], p: number): number {
  const rank = Math.min(
    sortedAscending.length,
    Math.max(1, Math.ceil((p / 100) * sortedAscending.length)),
  )
  return sortedAscending[rank - 1]
}

function percentOver(sortedAscending: readonly number[], thresholdMs: number): number {
  let countOver = 0
  for (const d of sortedAscending) {
    if (d > thresholdMs) countOver += 1
  }
  return (countOver / sortedAscending.length) * 100
}

/**
 * Percentiles by nearest-rank, computed only over samples tagged with `phase`. Never a mean:
 * the per-frame distribution is bimodal by construction, fast frames plus real stalls, so a
 * mean sits between the two modes and describes neither, and a single long stall gets
 * averaged away instead of showing up in `max`.
 *
 * `pctOver16_7` and `pctOver33_3` are two separate figures and must never be summed into one
 * "over budget" number. The 16.7 count necessarily includes every frame in the 33.3 count, since
 * a frame over 33.3ms is also over 16.7ms; that nesting is correct and expected. What matters is
 * that they stay reported apart, because 33.3ms coincides with WebKitGTK's measured idle floor,
 * and an engine sitting in its 30Hz regime shows 100% over 16.7ms while being perfectly smooth
 * for what it is. One merged figure would call that jank.
 *
 * The selected `phase` is stamped onto the result so a consumer can tell a driven summary from
 * a settle one without re-deriving it, and `degraded` marks a window too short for the tail
 * percentiles to mean anything (see `MIN_FRAMES_FOR_STABLE_PERCENTILES`). A short window is
 * still summarized rather than rejected, because a degraded number that says so is more useful
 * than no number at all when diagnosing why a gesture collected so few frames.
 *
 * Throws on an empty selection rather than returning a synthetic all-zero `FrameStats`,
 * because a caller reading `p95: 0` back would read that as "flawless" instead of "no data
 * for this phase was ever recorded".
 */
export function summarizeFrames(samples: readonly FrameSample[], phase: FramePhase): FrameStats {
  const deltas = samples
    .filter((s) => s.phase === phase)
    .map((s) => s.dt)
    .sort((a, b) => a - b)

  if (deltas.length === 0) {
    throw new Error(`summarizeFrames: no samples tagged '${phase}' to summarize`)
  }

  return {
    phase,
    count: deltas.length,
    degraded: deltas.length < MIN_FRAMES_FOR_STABLE_PERCENTILES,
    p50: nearestRank(deltas, 50),
    p95: nearestRank(deltas, 95),
    p99: nearestRank(deltas, 99),
    max: deltas[deltas.length - 1],
    pctOver16_7: percentOver(deltas, 16.7),
    pctOver33_3: percentOver(deltas, 33.3),
  }
}

/**
 * Percentiles over input-latency durations. Whatever precision the source has is the precision
 * these carry: `createDispatchLatencyProbe`, which feeds S8, is quantized to one animation
 * frame, so its percentiles name a frame boundary rather than a sub-millisecond measurement.
 *
 * Throws on an empty input for the same reason as `summarizeFrames`: a fabricated zero would
 * read as "instant response" rather than "nothing was observed".
 */
export function summarizeLatency(durations: readonly number[]): LatencyStats {
  const sorted = [...durations].sort((a, b) => a - b)

  if (sorted.length === 0) {
    throw new Error('summarizeLatency: no durations to summarize')
  }

  return {
    count: sorted.length,
    p95: nearestRank(sorted, 95),
    p99: nearestRank(sorted, 99),
    max: sorted[sorted.length - 1],
  }
}

// ---- Clock calibration ------------------------------------------------------------------

// Bands, not a single split point: the regimes this exists to tell apart cluster tightly
// around 16.7ms and 33.3ms, and anything in between or above them is genuinely neither, not
// a rounding error of one.
//
// 13ms sits between a 60Hz panel's 16.7ms and a 90Hz panel's 11.1ms, so ordinary jitter on
// 60Hz never crosses it while a 120Hz (8.3ms) or 144Hz (6.9ms) ceiling always does. That
// direction matters as much as the slow one: on a 120Hz panel an arm can drop every second
// frame, land at 16.67ms, and clear a 16.7ms bar it should have failed.
const SIXTY_HZ_FLOOR_MS = 13
const SIXTY_HZ_CEILING_MS = 20
const THIRTY_HZ_FLOOR_MS = 28
const THIRTY_HZ_CEILING_MS = 40

function classifyRegime(medianFrameMs: number): ClockCalibration['regime'] {
  if (medianFrameMs < SIXTY_HZ_FLOOR_MS) return 'faster-than-60hz'
  if (medianFrameMs < SIXTY_HZ_CEILING_MS) return '60hz'
  if (medianFrameMs >= THIRTY_HZ_FLOOR_MS && medianFrameMs <= THIRTY_HZ_CEILING_MS) return '30hz'
  return 'other'
}

/**
 * Drives a trivially cheap, always-dirty transform write on one element for `durationMs` and
 * reports the cadence achieved with almost no work on the main thread.
 *
 * This deliberately measures the CEILING, not cadence under load. Cadence under load is what
 * every scenario measures; what this establishes is the fastest this display and compositor
 * were ever going to go during this run, so a threshold can be read against something real.
 * Some engines run two distinct clean regimes, 60Hz and 30Hz, rather than one degrading
 * continuum, and a fixed 16.7ms bar is meaningless evidence when the window happened to sit in
 * the 30Hz regime for reasons that have nothing to do with the arm being measured.
 *
 * The probe is cheap on purpose and the work is a real change every frame, never a no-op that
 * some "skip if unchanged" path could drop without compositing. requestAnimationFrame runs on
 * the main thread, so the deltas still reflect main-thread scheduling rather than a compositor
 * fast path the scenarios would never get.
 */
export async function calibrateClock(durationMs: number): Promise<ClockCalibration> {
  const probe = document.createElement('div')
  probe.style.position = 'fixed'
  probe.style.top = '0'
  probe.style.left = '0'
  probe.style.width = '1px'
  probe.style.height = '1px'
  probe.style.opacity = '0.01'
  probe.style.pointerEvents = 'none'
  probe.style.willChange = 'transform'
  document.body.appendChild(probe)

  const sampler = createFrameSampler()

  let toggle = 0
  let driveRafId = 0
  function drive(): void {
    // Alternates the written value so every frame is a genuine change, never a no-op the
    // compositor (or some "skip if unchanged" optimization further down the stack) could
    // drop without actually compositing a frame.
    toggle = toggle === 0 ? 1 : 0
    probe.style.transform = `translateX(${toggle}px)`
    driveRafId = requestAnimationFrame(drive)
  }

  try {
    sampler.start()
    // After start, which clears the phase back to 'warmup'. No frame can land between these
    // two synchronous calls, so every recorded delta is still tagged 'driven'.
    sampler.setPhase('driven')
    driveRafId = requestAnimationFrame(drive)
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
  } finally {
    cancelAnimationFrame(driveRafId)
    sampler.stop()
    probe.remove()
  }

  const stats = summarizeFrames(sampler.collect(), 'driven')
  const medianFrameMs = stats.p50

  return {
    medianFrameMs,
    impliedHz: 1000 / medianFrameMs,
    regime: classifyRegime(medianFrameMs),
  }
}

// ---- Event Timing (corroboration only) ---------------------------------------------------

export interface EventTimingObserver {
  /**
   * False when this engine has no Event Timing at all. The observer still exists and reports
   * nothing, because its absence is a fact to record next to the run, not a reason to stop.
   */
  readonly available: boolean
  /** Why it is unavailable, for the run record. Null when `available` is true. */
  readonly unavailableReason: string | null
  /** Durations collected so far, in arrival order. Spec-rounded to 8ms. */
  durations(): readonly number[]
  /** Total entries observed. Zero is the expected reading under synthetic dispatch. */
  entryCount(): number
  disconnect(): void
}

/** `durationThreshold` is part of the Event Timing spec but missing from TS's lib.dom types. */
interface EventTimingObserveInit extends PerformanceObserverInit {
  readonly durationThreshold?: number
}

/**
 * Event Timing is observed as corroboration and nothing else. It only creates entries for
 * user-agent-generated events, and every event this harness produces is synthesized through
 * `dispatchEvent`, so an entry count of zero is the expected reading rather than a failure.
 * That is why construction never throws and why an unavailable engine gets an observer that
 * reports nothing instead of an exception: no gating number may depend on this, so its absence
 * must not be able to abort a run. Entries appearing at all under synthetic dispatch would
 * itself be the surprise, which is the only reason this is still wired up.
 *
 * S8's actual metric is `createDispatchLatencyProbe` below.
 */
export function createEventTimingObserver(): EventTimingObserver {
  const unavailable = (reason: string): EventTimingObserver => ({
    available: false,
    unavailableReason: reason,
    durations: () => [],
    entryCount: () => 0,
    disconnect: () => {},
  })

  if (typeof PerformanceObserver === 'undefined') {
    return unavailable('PerformanceObserver is unavailable on this engine')
  }

  const supported = PerformanceObserver.supportedEntryTypes ?? []
  if (!supported.includes('event')) {
    return unavailable(
      `'event' is not in PerformanceObserver.supportedEntryTypes: [${supported.join(', ')}]`,
    )
  }

  const durations: number[] = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      durations.push(entry.duration)
    }
  })

  const init: EventTimingObserveInit = {
    type: 'event',
    // Not buffered: a buffered read would prefill this with whatever real entries sat in the
    // timeline since page load, the operator's click on the run button included, and those
    // would then be reported as if the measured gesture had produced them.
    buffered: false,
    // 0 asks for every event; the UA clamps to its own floor regardless.
    durationThreshold: 0,
  }
  observer.observe(init)

  return {
    available: true,
    unavailableReason: null,
    durations: () => durations.slice(),
    entryCount: () => durations.length,
    disconnect: () => observer.disconnect(),
  }
}

// ---- Dispatch-to-painted latency ---------------------------------------------------------

/** One second is far past any threshold S8 could pass; reaching it means the input was lost. */
const DEFAULT_DISPATCH_TIMEOUT_MS = 1000

export interface DispatchLatencySample {
  /**
   * Milliseconds from the dispatch call to the animation frame whose callback first saw the
   * arm's own state reflect it. Quantized to one frame, roughly 16.7ms, because that is the
   * resolution of the only clock that can see a paint.
   */
  readonly elapsedMs: number
  /** Animation frames between the dispatch and that observation, the landing frame included. */
  readonly frames: number
  /** True when the state never reflected the dispatch. `elapsedMs` is then time waited, not latency. */
  readonly timedOut: boolean
}

export interface DispatchLatencyProbe {
  /**
   * Calls `dispatch`, then polls `hasLanded` once per animation frame until it first returns
   * true. `hasLanded` must read the ARM's own observable state, not anything the driver wrote,
   * which is what makes a landed sample proof that the arm's handler ran.
   */
  measure(dispatch: () => void, hasLanded: () => boolean): Promise<DispatchLatencySample>
  /** Every sample in measurement order, timeouts included. */
  samples(): readonly DispatchLatencySample[]
  /** Elapsed times of the samples that landed. The input to `summarizeLatency`. */
  landedDurations(): readonly number[]
  /** Dispatches whose effect never became observable. Each one is an input the arm dropped. */
  timeoutCount(): number
  reset(): void
}

/**
 * Measures dispatch-to-painted-change by counting animation frames, which is the only latency
 * measurement available to a harness that dispatches synthetic events.
 *
 * A landing is recorded on the first frame callback that observes the change. That callback
 * runs before the frame it belongs to is painted, so the reported figure is the interval to the
 * frame that shows the change rather than to the pixels themselves, short by that frame's own
 * render time. At a 50ms pass bar, three frames, that bias is well inside the metric's own
 * one-frame resolution.
 *
 * A timeout settles the sample instead of rejecting, so a dropped input is counted and reported
 * rather than taking the run down. The timeout is armed on both `setTimeout` and the frame
 * chain: if the compositor stops delivering frames, which is how an occluded window behaves,
 * the rAF-only arm would never fire and the measurement would hang forever.
 */
export function createDispatchLatencyProbe(
  timeoutMs: number = DEFAULT_DISPATCH_TIMEOUT_MS,
): DispatchLatencyProbe {
  const collected: DispatchLatencySample[] = []

  function measure(
    dispatch: () => void,
    hasLanded: () => boolean,
  ): Promise<DispatchLatencySample> {
    return new Promise<DispatchLatencySample>((resolve) => {
      let frames = 0
      let settled = false
      let rafId: number | null = null
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      function settle(elapsedMs: number, timedOut: boolean): void {
        if (settled) return
        settled = true
        if (rafId !== null) cancelAnimationFrame(rafId)
        if (timeoutId !== null) clearTimeout(timeoutId)
        const sample: DispatchLatencySample = { elapsedMs, frames, timedOut }
        collected.push(sample)
        resolve(sample)
      }

      const startedAt = performance.now()

      function onFrame(t: DOMHighResTimeStamp): void {
        frames += 1
        if (hasLanded()) {
          // rAF timestamps share performance.now's time origin, so this subtraction is valid.
          // Clamped at 0 because a frame already queued when the dispatch happened can carry a
          // timestamp fractionally before it.
          settle(Math.max(0, t - startedAt), false)
          return
        }
        const elapsed = performance.now() - startedAt
        if (elapsed >= timeoutMs) {
          settle(elapsed, true)
          return
        }
        rafId = requestAnimationFrame(onFrame)
      }

      timeoutId = setTimeout(() => settle(performance.now() - startedAt, true), timeoutMs)

      dispatch()
      rafId = requestAnimationFrame(onFrame)
    })
  }

  return {
    measure,
    samples: () => collected.slice(),
    landedDurations: () => collected.filter((s) => !s.timedOut).map((s) => s.elapsedMs),
    timeoutCount: () => collected.filter((s) => s.timedOut).length,
    reset: () => {
      collected.length = 0
    },
  }
}
