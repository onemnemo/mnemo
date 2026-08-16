// @vitest-environment jsdom

/**
 * The stall cases matter as much as the happy ones: a rAF chain re-armed only from inside
 * its own callback cannot notice that it stopped being called, so an occluded window used
 * to hang the run rather than report anything.
 */

import { describe, expect, it } from 'vitest'

import type { ClockCalibration, FramePhase } from './contract'
import {
  FrameClockStallError,
  awaitFrames,
  awaitSettled,
  driveFrames,
  nextAnimationFrame,
} from './driver-clock'

interface FakeRaf {
  readonly win: Window
  tick: (dt?: number) => Promise<void>
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

function makeFakeRaf(): FakeRaf {
  let queue: FrameRequestCallback[] = []
  let now = performance.now()
  const win = {
    requestAnimationFrame: (cb: FrameRequestCallback): number => {
      queue.push(cb)
      return queue.length
    },
  } as unknown as Window
  async function tick(dt = 16.7): Promise<void> {
    now += dt
    const callbacks = queue
    queue = []
    for (const cb of callbacks) cb(now)
    await flushMicrotasks()
  }
  return { win, tick }
}

/** A window whose frame clock never fires, which is what a backgrounded webview looks like. */
const deadClock = { requestAnimationFrame: (): number => 1 } as unknown as Window

const calibration: ClockCalibration = { medianFrameMs: 16.7, impliedHz: 60, regime: '60hz' }

describe('nextAnimationFrame', () => {
  it('resolves with the frame timestamp, which is the clock every measurement is on', async () => {
    const raf = makeFakeRaf()
    const promise = nextAnimationFrame(raf.win)
    await raf.tick()
    await expect(promise).resolves.toBeGreaterThan(0)
  })

  it('gives up with a named stall instead of waiting forever on a clock that stopped', async () => {
    await expect(nextAnimationFrame(deadClock, 20)).rejects.toBeInstanceOf(FrameClockStallError)
  })
})

describe('awaitFrames', () => {
  it('resolves only after n real frame ticks, not synchronously', async () => {
    const raf = makeFakeRaf()
    let resolved = false
    void awaitFrames(2, raf.win).then(() => {
      resolved = true
    })

    await flushMicrotasks()
    expect(resolved).toBe(false)

    await raf.tick()
    expect(resolved).toBe(false) // only one of two frames has ticked

    await raf.tick()
    expect(resolved).toBe(true)
  })

  it('resolves immediately for n <= 0 without requiring a real clock', async () => {
    await expect(awaitFrames(0, {} as Window)).resolves.toBeUndefined()
  })

  it('throws synchronously when requestAnimationFrame is unavailable, rather than hanging', () => {
    expect(() => awaitFrames(1, {} as Window)).toThrow(/requestAnimationFrame/)
  })

  it('reports a stall rather than hanging when frames stop arriving entirely', async () => {
    await expect(awaitFrames(3, deadClock, 20)).rejects.toThrow(/frame clock stalled/)
  })
})

describe('awaitSettled', () => {
  it('resolves settled once enough consecutive frames land inside the calibrated idle band', async () => {
    const raf = makeFakeRaf()
    const promise = awaitSettled(calibration, { win: raf.win, windowSize: 3, toleranceFactor: 1.5 })

    await raf.tick(40) // seeds the clock; its delta is call-to-first-frame, not a frame interval
    await raf.tick(40) // busy
    await raf.tick(10) // quiet 1
    await raf.tick(10) // quiet 2
    await raf.tick(10) // quiet 3 -> settled

    const result = await promise
    expect(result.settled).toBe(true)
    expect(result.stalled).toBe(false)
    expect(result.framesObserved).toBe(5)
  })

  it('a single busy frame resets the quiet streak, so settling needs a real consecutive run', async () => {
    const raf = makeFakeRaf()
    const promise = awaitSettled(calibration, {
      win: raf.win,
      windowSize: 3,
      toleranceFactor: 1.5,
      maxWaitMs: 100000,
    })

    await raf.tick(10) // seeds
    await raf.tick(10) // quiet 1
    await raf.tick(40) // busy: streak resets
    await raf.tick(10) // quiet 1 (again)
    await raf.tick(10) // quiet 2
    await raf.tick(10) // quiet 3 -> settled now

    const result = await promise
    expect(result.settled).toBe(true)
    expect(result.framesObserved).toBe(6)
  })

  it('gives up and reports unsettled once maxWaitMs elapses, rather than waiting forever', async () => {
    const raf = makeFakeRaf()
    const promise = awaitSettled(calibration, {
      win: raf.win,
      windowSize: 3,
      toleranceFactor: 1.5,
      maxWaitMs: 100,
    })

    for (let i = 0; i < 6; i++) await raf.tick(40) // permanently busy, never quiets down

    const result = await promise
    expect(result.settled).toBe(false)
    expect(result.waitedMs).toBeGreaterThanOrEqual(100)
  })

  it('reports a stall as unsettled when frames stop arriving, rather than hanging the run', async () => {
    const result = await awaitSettled(calibration, { win: deadClock, stallTimeoutMs: 20 })
    expect(result.settled).toBe(false)
    expect(result.stalled).toBe(true)
    expect(result.framesObserved).toBe(0)
  })

  it('rejects when requestAnimationFrame is unavailable', async () => {
    await expect(awaitSettled(calibration, { win: {} as Window })).rejects.toThrow(/requestAnimationFrame/)
  })
})

describe('driveFrames', () => {
  it('drives one callback per frame for the requested duration, not per requested step', async () => {
    const raf = makeFakeRaf()
    const seen: number[] = []
    const promise = driveFrames({
      win: raf.win,
      warmupMs: 0,
      durationMs: 167, // ten frames of the fake clock's 16.7ms cadence
      onFrame: (progress) => seen.push(progress.fraction),
    })

    for (let i = 0; i < 20; i++) await raf.tick()
    const window = await promise

    expect(window.frames).toBeGreaterThanOrEqual(10)
    // The origin frame dispatches nothing, so the first dispatch already carries motion: a
    // zero-displacement move would read as an input the arm ignored.
    expect(seen[0]).toBeGreaterThan(0)
    expect(seen[0]).toBeLessThan(0.2)
    expect(seen[seen.length - 1]).toBe(1) // the last frame always lands the full displacement
  })

  it('separates warmup from driven and reports both bounds on the absolute clock', async () => {
    const raf = makeFakeRaf()
    const phases: FramePhase[] = []
    const promise = driveFrames({
      win: raf.win,
      warmupMs: 50,
      durationMs: 100,
      onPhase: (phase) => phases.push(phase),
      onFrame: () => {},
    })

    for (let i = 0; i < 20; i++) await raf.tick()
    const window = await promise

    expect(phases).toEqual(['warmup', 'driven'])
    expect(window.drivenFrames).toBeLessThan(window.frames)
    expect(window.drivenStartedAt).toBeGreaterThan(window.startedAt)
    expect(window.endedAt).toBeGreaterThanOrEqual(window.drivenStartedAt)
  })

  it('surfaces a stalled frame clock instead of driving nothing forever', async () => {
    await expect(
      driveFrames({
        win: deadClock,
        warmupMs: 0,
        durationMs: 1000,
        stallTimeoutMs: 20,
        onFrame: () => {},
      }),
    ).rejects.toThrow(/frame clock stalled/)
  })
})
