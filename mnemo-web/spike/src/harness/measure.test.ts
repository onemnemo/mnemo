// @vitest-environment jsdom

/**
 * Tests drive `requestAnimationFrame` manually rather than trusting a real animation clock:
 * real rAF timing is nondeterministic and slow to await, and the numbers this module produces
 * decide a project phase, so the tests need exact control over what "one frame" means.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MIN_FRAMES_FOR_STABLE_PERCENTILES,
  calibrateClock,
  createDispatchLatencyProbe,
  createEventTimingObserver,
  createFrameSampler,
  summarizeFrames,
  summarizeLatency,
} from './measure'
import type { FrameSample } from './contract'

function installManualRaf(): {
  flush: (t: number) => void
  pendingCount: () => number
} {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id)
  })

  return {
    // Invokes every callback queued right now, with timestamp `t`, as a single frame. Chains
    // that reschedule themselves inside their own callback queue a fresh entry, which is not
    // touched until the next flush, matching how a real animation frame behaves.
    flush(t: number): void {
      const pending = [...callbacks.entries()]
      callbacks.clear()
      for (const [, cb] of pending) cb(t)
    },
    pendingCount(): number {
      return callbacks.size
    },
  }
}

// A `performance.now` under test control, so elapsed times never depend on whether the fake
// timer install happens to cover the performance clock on this vitest version.
function installManualNow(): { set: (t: number) => void } {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  return {
    set(t: number): void {
      now = t
    },
  }
}

// Mocks are restored before the fake timers are uninstalled: the manual `performance.now` spy
// is installed on top of whatever the fake clock put there, so unwinding in the other order
// would leave the fake reader in place for every later test in this file.
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('createFrameSampler', () => {
  it('records no delta for the first frame, it only establishes the clock origin', () => {
    const raf = installManualRaf()
    const sampler = createFrameSampler()
    sampler.start()
    raf.flush(0)
    expect(sampler.collect()).toEqual([])
  })

  it('records dt as the gap between consecutive frames, tagged with the current phase', () => {
    const raf = installManualRaf()
    const sampler = createFrameSampler()
    sampler.start()
    // After start, which clears the phase: no frame can land between the two calls.
    sampler.setPhase('driven')
    raf.flush(0)
    raf.flush(16.7)
    expect(sampler.collect()).toEqual([{ t: 16.7, dt: 16.7, phase: 'driven' }])
  })

  it('tags each sample with whichever phase was current when that frame landed', () => {
    const raf = installManualRaf()
    const sampler = createFrameSampler()
    sampler.start()
    raf.flush(0) // warmup origin, no sample
    raf.flush(16) // warmup delta
    sampler.setPhase('driven')
    raf.flush(33) // driven delta
    sampler.setPhase('settle')
    raf.flush(50) // settle delta

    const samples = sampler.collect()
    expect(samples.map((s) => s.phase)).toEqual(['warmup', 'driven', 'settle'])
    expect(samples.map((s) => s.dt)).toEqual([16, 17, 17])
  })

  it('stops recording once stopped, and cancels the pending frame', () => {
    const raf = installManualRaf()
    const sampler = createFrameSampler()
    sampler.start()
    raf.flush(0)
    expect(raf.pendingCount()).toBe(1) // tick rescheduled itself
    sampler.stop()
    expect(raf.pendingCount()).toBe(0) // cancelled, nothing left to flush
    raf.flush(100)
    expect(sampler.collect()).toEqual([])
  })

  it('stop is a safe no-op when the sampler was never started', () => {
    const sampler = createFrameSampler()
    expect(() => sampler.stop()).not.toThrow()
  })

  it('throws if started twice without an intervening stop, a double-start is a driver bug', () => {
    installManualRaf()
    const sampler = createFrameSampler()
    sampler.start()
    expect(() => sampler.start()).toThrow()
  })

  it('clears the previous cycle on start, so one run never pools into the next', () => {
    const raf = installManualRaf()
    const sampler = createFrameSampler()

    sampler.start()
    sampler.setPhase('driven')
    raf.flush(0)
    raf.flush(50) // a stall belonging to the first run
    sampler.stop()
    expect(sampler.collect()).toHaveLength(1)

    sampler.start()
    sampler.setPhase('driven')
    raf.flush(100)
    raf.flush(116)
    expect(sampler.collect()).toEqual([{ t: 116, dt: 16, phase: 'driven' }])
  })

  it('returns the phase to warmup on start, so a settle tag cannot leak into the next run', () => {
    const raf = installManualRaf()
    const sampler = createFrameSampler()

    sampler.start()
    sampler.setPhase('settle')
    raf.flush(0)
    raf.flush(16)
    sampler.stop()

    sampler.start()
    raf.flush(100)
    raf.flush(116)
    expect(sampler.collect().map((s) => s.phase)).toEqual(['warmup'])
  })

  it('does not measure the first delta after a clear across the boundary', () => {
    const raf = installManualRaf()
    const sampler = createFrameSampler()

    sampler.start()
    raf.flush(0)
    raf.flush(16)
    sampler.stop()

    // A 900ms gap between runs must not become a 900ms frame in the second run.
    sampler.start()
    raf.flush(916)
    raf.flush(932)
    expect(sampler.collect().map((s) => s.dt)).toEqual([16])
  })

  it('reset drops the samples and the phase without touching the running rAF chain', () => {
    const raf = installManualRaf()
    const sampler = createFrameSampler()

    sampler.start()
    sampler.setPhase('driven')
    raf.flush(0)
    raf.flush(16)
    expect(sampler.collect()).toHaveLength(1)

    sampler.reset()
    expect(sampler.collect()).toEqual([])
    expect(raf.pendingCount()).toBe(1) // still sampling

    raf.flush(32)
    raf.flush(48)
    expect(sampler.collect()).toEqual([{ t: 48, dt: 16, phase: 'warmup' }])
  })

  it('collect returns a fresh snapshot each call, not a live reference', () => {
    const raf = installManualRaf()
    const sampler = createFrameSampler()
    sampler.start()
    raf.flush(0)
    raf.flush(10)
    const first = sampler.collect()
    const second = sampler.collect()
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })
})

describe('summarizeFrames', () => {
  function sample(dt: number, phase: FrameSample['phase'] = 'driven'): FrameSample {
    return { t: dt, dt, phase }
  }

  it('computes nearest-rank percentiles over a known distribution', () => {
    const deltas = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const samples = deltas.map((dt) => sample(dt))
    const stats = summarizeFrames(samples, 'driven')

    expect(stats.count).toBe(10)
    expect(stats.p50).toBe(50) // ceil(0.5 * 10) = 5th ranked value
    expect(stats.p95).toBe(100) // ceil(0.95 * 10) = 10th ranked value
    expect(stats.p99).toBe(100)
    expect(stats.max).toBe(100)
  })

  it('only counts strictly-over, a frame sitting exactly on the budget is not jank', () => {
    const samples = [sample(16.7), sample(16.7), sample(33.3), sample(33.3)]
    const stats = summarizeFrames(samples, 'driven')
    expect(stats.pctOver16_7).toBe(50) // only the two 33.3ms frames exceed 16.7
    expect(stats.pctOver33_3).toBe(0) // none strictly exceed 33.3
  })

  it('reports pctOver16_7 and pctOver33_3 independently, never pooled', () => {
    const samples = [sample(10), sample(20), sample(40)]
    const stats = summarizeFrames(samples, 'driven')
    expect(stats.pctOver16_7).toBeCloseTo((2 / 3) * 100, 6) // 20 and 40
    expect(stats.pctOver33_3).toBeCloseTo((1 / 3) * 100, 6) // only 40
  })

  it('filters to the requested phase and ignores every other phase', () => {
    const samples = [sample(5, 'warmup'), sample(100, 'warmup'), sample(20, 'driven'), sample(30, 'settle')]
    const stats = summarizeFrames(samples, 'driven')
    expect(stats.count).toBe(1)
    expect(stats.max).toBe(20)
  })

  it('throws rather than returning a synthetic zero when the phase has no samples', () => {
    const samples = [sample(20, 'warmup')]
    expect(() => summarizeFrames(samples, 'driven')).toThrow()
    expect(() => summarizeFrames([], 'driven')).toThrow()
  })

  it('stamps the phase it summarized, so a settle summary cannot pass as a driven one', () => {
    const samples = [sample(20, 'driven'), sample(30, 'settle')]
    expect(summarizeFrames(samples, 'driven').phase).toBe('driven')
    expect(summarizeFrames(samples, 'settle').phase).toBe('settle')
  })

  it('marks a short window degraded, where p95 and p99 have collapsed onto max', () => {
    const samples = new Array<number>(10).fill(16).map((dt) => sample(dt))
    const stats = summarizeFrames(samples, 'driven')
    expect(stats.degraded).toBe(true)
    expect(stats.p95).toBe(stats.max) // the collapse the flag is warning about
    expect(stats.p99).toBe(stats.max)
  })

  it('is not degraded once the window carries enough frames for distinct tail ranks', () => {
    const deltas = new Array<number>(MIN_FRAMES_FOR_STABLE_PERCENTILES).fill(16)
    // One genuine outlier, which only a non-collapsed distribution can separate from p95.
    deltas[deltas.length - 1] = 120
    const stats = summarizeFrames(
      deltas.map((dt) => sample(dt)),
      'driven',
    )
    expect(stats.degraded).toBe(false)
    expect(stats.count).toBe(MIN_FRAMES_FOR_STABLE_PERCENTILES)
    expect(stats.p95).toBe(16)
    expect(stats.max).toBe(120)
  })

  it('counts degradation against the phase-filtered window, not the whole sample array', () => {
    const driven = new Array<number>(20).fill(16).map((dt) => sample(dt, 'driven'))
    const warmup = new Array<number>(300).fill(16).map((dt) => sample(dt, 'warmup'))
    expect(summarizeFrames([...driven, ...warmup], 'driven').degraded).toBe(true)
  })
})

describe('summarizeLatency', () => {
  it('computes nearest-rank percentiles over the raw durations', () => {
    const durations = [8, 16, 24, 32, 40, 48, 56, 64, 72, 80]
    const stats = summarizeLatency(durations)
    expect(stats.count).toBe(10)
    expect(stats.p95).toBe(80)
    expect(stats.p99).toBe(80)
    expect(stats.max).toBe(80)
  })

  it('does not require sorted input', () => {
    const stats = summarizeLatency([80, 8, 40])
    expect(stats.max).toBe(80)
  })

  it('throws rather than returning a synthetic zero for no observations', () => {
    expect(() => summarizeLatency([])).toThrow()
  })
})

describe('calibrateClock', () => {
  // Flushes an origin frame plus one frame per delta in `deltas`, then lets the calibration
  // window elapse, and returns the settled result (or the rejection, for the failure test).
  async function runCalibration(deltas: readonly number[], durationMs = 1000) {
    // Fake timers first: vitest's fake-timers install their own requestAnimationFrame
    // shim driven by the fake clock, so the manual rAF stub must be installed after it to
    // win the override and stay in full, explicit control of what "one frame" means.
    vi.useFakeTimers()
    const raf = installManualRaf()
    const promise = calibrateClock(durationMs)
    // Marks the promise handled immediately so a rejection that happens while the fake
    // clock is being advanced below (before the caller's own `.rejects` assertion attaches)
    // never surfaces as a spurious unhandled-rejection warning. The caller still observes
    // the real resolution or rejection through the returned `promise` below.
    promise.catch(() => {})

    raf.flush(0)
    let t = 0
    for (const d of deltas) {
      t += d
      raf.flush(t)
    }

    await vi.advanceTimersByTimeAsync(durationMs)
    return promise
  }

  it('classifies a clean 60Hz cadence', async () => {
    const result = await runCalibration(new Array<number>(10).fill(16.7))
    expect(result.regime).toBe('60hz')
    expect(result.medianFrameMs).toBeCloseTo(16.7, 3)
    expect(result.impliedHz).toBeCloseTo(1000 / 16.7, 3)
  })

  it('classifies a clean 30Hz cadence', async () => {
    const result = await runCalibration(new Array<number>(10).fill(33.3))
    expect(result.regime).toBe('30hz')
  })

  it('classifies a cadence in neither clean regime as other', async () => {
    const result = await runCalibration(new Array<number>(10).fill(24))
    expect(result.regime).toBe('other')
  })

  it('flags a 120Hz ceiling rather than reporting it as an ordinary 60Hz machine', async () => {
    const result = await runCalibration(new Array<number>(10).fill(8.3))
    expect(result.regime).toBe('faster-than-60hz')
    expect(result.impliedHz).toBeCloseTo(1000 / 8.3, 3)
  })

  it('flags a 144Hz ceiling the same way', async () => {
    const result = await runCalibration(new Array<number>(10).fill(6.94))
    expect(result.regime).toBe('faster-than-60hz')
  })

  it('leaves an ordinary 60Hz panel with jitter classified as 60hz', async () => {
    const result = await runCalibration([15, 16.7, 18, 16.7, 14.5, 16.7, 17.5, 16.7, 16, 19])
    expect(result.regime).toBe('60hz')
  })

  it('tags its samples driven despite start clearing the phase, so nothing is filtered away', async () => {
    const result = await runCalibration(new Array<number>(6).fill(16.7))
    expect(result.medianFrameMs).toBeCloseTo(16.7, 3)
  })

  it('removes the probe element from the document once calibration finishes', async () => {
    expect(document.body.children.length).toBe(0)
    await runCalibration(new Array<number>(5).fill(16.7))
    expect(document.body.children.length).toBe(0)
  })

  it('fails loudly rather than returning a fabricated result when no driven frame ever lands', async () => {
    // Only the origin frame is flushed, so no delta is ever recorded for the 'driven' phase.
    await expect(runCalibration([])).rejects.toThrow()
    // The probe must still be cleaned up even though the calibration itself failed.
    expect(document.body.children.length).toBe(0)
  })
})

describe('createEventTimingObserver', () => {
  interface FakeEntry {
    readonly duration: number
  }

  class FakePerformanceObserver {
    static supportedEntryTypes: readonly string[] = ['event']
    static instances: FakePerformanceObserver[] = []

    observedInit: PerformanceObserverInit | undefined
    disconnected = false
    private readonly callback: (list: { getEntries(): FakeEntry[] }) => void

    constructor(callback: (list: { getEntries(): FakeEntry[] }) => void) {
      this.callback = callback
      FakePerformanceObserver.instances.push(this)
    }

    observe(init: PerformanceObserverInit): void {
      this.observedInit = init
    }

    disconnect(): void {
      this.disconnected = true
    }

    emit(durations: readonly number[]): void {
      this.callback({ getEntries: () => durations.map((duration) => ({ duration })) })
    }
  }

  beforeEach(() => {
    FakePerformanceObserver.instances = []
  })

  it('reports unavailable instead of throwing when PerformanceObserver does not exist', () => {
    vi.stubGlobal('PerformanceObserver', undefined)
    const observer = createEventTimingObserver()
    expect(observer.available).toBe(false)
    expect(observer.unavailableReason).toMatch(/PerformanceObserver/)
    // Absence is recorded, never fatal: no gating metric is allowed to depend on this.
    expect(observer.durations()).toEqual([])
    expect(observer.entryCount()).toBe(0)
    expect(() => observer.disconnect()).not.toThrow()
  })

  it("reports unavailable, not a throw, when 'event' is not in supportedEntryTypes", () => {
    class NoEventSupport extends FakePerformanceObserver {
      static override supportedEntryTypes: readonly string[] = ['paint', 'mark']
    }
    vi.stubGlobal('PerformanceObserver', NoEventSupport)
    const observer = createEventTimingObserver()
    expect(observer.available).toBe(false)
    expect(observer.unavailableReason).toMatch(/supportedEntryTypes/)
  })

  it('marks itself available and carries no reason when the engine supports Event Timing', () => {
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)
    const observer = createEventTimingObserver()
    expect(observer.available).toBe(true)
    expect(observer.unavailableReason).toBeNull()
  })

  it('observes unbuffered, so entries predating the run cannot be read as its own', () => {
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)
    createEventTimingObserver()
    const fake = FakePerformanceObserver.instances.at(-1)
    expect(fake?.observedInit).toMatchObject({ type: 'event', buffered: false, durationThreshold: 0 })
  })

  it('collects durations and exposes the raw entry count as entries arrive', () => {
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)
    const observer = createEventTimingObserver()
    const fake = FakePerformanceObserver.instances.at(-1)

    fake?.emit([8, 16, 24])
    expect(observer.durations()).toEqual([8, 16, 24])
    expect(observer.entryCount()).toBe(3)

    fake?.emit([32])
    expect(observer.durations()).toEqual([8, 16, 24, 32])
    expect(observer.entryCount()).toBe(4)
  })

  it('disconnect tears down the underlying observer', () => {
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)
    const observer = createEventTimingObserver()
    const fake = FakePerformanceObserver.instances.at(-1)
    observer.disconnect()
    expect(fake?.disconnected).toBe(true)
  })
})

describe('createDispatchLatencyProbe', () => {
  it('resolves on the first frame whose callback sees the state reflect the dispatch', async () => {
    vi.useFakeTimers()
    const raf = installManualRaf()
    const clock = installManualNow()
    const probe = createDispatchLatencyProbe()

    let landed = false
    clock.set(100)
    const pending = probe.measure(
      () => {},
      () => landed,
    )

    raf.flush(116.7) // still nothing to see
    landed = true
    raf.flush(133.4) // the frame that will paint the change

    const sample = await pending
    expect(sample.timedOut).toBe(false)
    expect(sample.elapsedMs).toBeCloseTo(33.4, 3)
    expect(sample.frames).toBe(2)
  })

  it('dispatches once, synchronously, before any frame is counted', async () => {
    vi.useFakeTimers()
    const raf = installManualRaf()
    installManualNow()
    const probe = createDispatchLatencyProbe()

    let dispatches = 0
    let framesAtDispatch = -1
    let frames = 0
    const pending = probe.measure(
      () => {
        dispatches += 1
        framesAtDispatch = frames
      },
      () => true,
    )
    expect(dispatches).toBe(1)
    expect(framesAtDispatch).toBe(0)

    frames += 1
    raf.flush(16.7)
    await pending
    expect(dispatches).toBe(1)
  })

  it('reports one frame when the arm reflects the dispatch immediately', async () => {
    vi.useFakeTimers()
    const raf = installManualRaf()
    const clock = installManualNow()
    const probe = createDispatchLatencyProbe()

    clock.set(0)
    const pending = probe.measure(
      () => {},
      () => true,
    )
    raf.flush(16.7)

    const sample = await pending
    expect(sample.frames).toBe(1)
    expect(sample.elapsedMs).toBeCloseTo(16.7, 3)
  })

  it('clamps to zero rather than reporting a negative latency from an already-queued frame', async () => {
    vi.useFakeTimers()
    const raf = installManualRaf()
    const clock = installManualNow()
    const probe = createDispatchLatencyProbe()

    clock.set(50)
    const pending = probe.measure(
      () => {},
      () => true,
    )
    raf.flush(49.9) // a frame timestamp fractionally before the dispatch

    await expect(pending).resolves.toMatchObject({ elapsedMs: 0, timedOut: false })
  })

  it('times out instead of hanging when the state never reflects the dispatch', async () => {
    vi.useFakeTimers()
    const raf = installManualRaf()
    const clock = installManualNow()
    const probe = createDispatchLatencyProbe(100)

    clock.set(0)
    const pending = probe.measure(
      () => {},
      () => false,
    )

    clock.set(50)
    raf.flush(50)
    clock.set(120)
    raf.flush(120)

    const sample = await pending
    expect(sample.timedOut).toBe(true)
    expect(sample.elapsedMs).toBeCloseTo(120, 3)
    // Nothing left running once it settles.
    expect(raf.pendingCount()).toBe(0)
  })

  it('still settles when the frame clock stalls entirely, as an occluded window does', async () => {
    vi.useFakeTimers()
    installManualRaf()
    const clock = installManualNow()
    const probe = createDispatchLatencyProbe(100)

    clock.set(0)
    const pending = probe.measure(
      () => {},
      () => false,
    )

    // No frame is ever flushed: only the setTimeout arm can settle this.
    clock.set(100)
    await vi.advanceTimersByTimeAsync(100)

    await expect(pending).resolves.toMatchObject({ timedOut: true, frames: 0 })
  })

  it('cancels the pending frame once it settles', async () => {
    vi.useFakeTimers()
    const raf = installManualRaf()
    installManualNow()
    const probe = createDispatchLatencyProbe()

    const pending = probe.measure(
      () => {},
      () => true,
    )
    raf.flush(16.7)
    await pending
    expect(raf.pendingCount()).toBe(0)
  })

  it('keeps timed-out dispatches out of the latency pool and counts them as dropped input', async () => {
    vi.useFakeTimers()
    const raf = installManualRaf()
    const clock = installManualNow()
    const probe = createDispatchLatencyProbe(100)

    clock.set(0)
    const first = probe.measure(
      () => {},
      () => true,
    )
    raf.flush(20)
    await first

    clock.set(0)
    const second = probe.measure(
      () => {},
      () => false,
    )
    clock.set(150)
    raf.flush(150)
    await second

    expect(probe.samples()).toHaveLength(2)
    expect(probe.landedDurations()).toEqual([20])
    expect(probe.timeoutCount()).toBe(1)
    // The pool that feeds summarizeLatency must never carry a timeout's wait as a latency.
    expect(summarizeLatency(probe.landedDurations()).max).toBe(20)
  })

  it('accumulates across measurements and clears on reset', async () => {
    vi.useFakeTimers()
    const raf = installManualRaf()
    const clock = installManualNow()
    const probe = createDispatchLatencyProbe()

    for (const elapsed of [16.7, 33.4]) {
      clock.set(0)
      const pending = probe.measure(
        () => {},
        () => true,
      )
      raf.flush(elapsed)
      await pending
    }

    expect(probe.samples()).toHaveLength(2)
    expect(probe.landedDurations()).toEqual([16.7, 33.4])

    probe.reset()
    expect(probe.samples()).toEqual([])
    expect(probe.landedDurations()).toEqual([])
    expect(probe.timeoutCount()).toBe(0)
  })

  it('samples returns a snapshot, not a live reference into the probe', async () => {
    vi.useFakeTimers()
    const raf = installManualRaf()
    installManualNow()
    const probe = createDispatchLatencyProbe()

    const pending = probe.measure(
      () => {},
      () => true,
    )
    raf.flush(16.7)
    await pending

    const snapshot = probe.samples()
    probe.reset()
    expect(snapshot).toHaveLength(1)
  })
})
