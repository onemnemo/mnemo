import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  awaitStrictModeDetection,
  resetStrictModeDetectionForTests,
  resolveStrictModeDetection,
} from './strict-mode-detection'

beforeEach(() => {
  resetStrictModeDetectionForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('resolveStrictModeDetection / awaitStrictModeDetection', () => {
  it('resolves immediately when the result is already known', async () => {
    resolveStrictModeDetection(true)
    await expect(awaitStrictModeDetection()).resolves.toBe(true)
  })

  it('resolves a caller that was already waiting once the probe reports', async () => {
    const pending = awaitStrictModeDetection(10_000)
    resolveStrictModeDetection(false)
    await expect(pending).resolves.toBe(false)
  })

  it('resolves every concurrent waiter with the same observation', async () => {
    const a = awaitStrictModeDetection(10_000)
    const b = awaitStrictModeDetection(10_000)
    resolveStrictModeDetection(true)
    await expect(a).resolves.toBe(true)
    await expect(b).resolves.toBe(true)
  })

  it('is one-shot: the first observation wins and later calls are no-ops', async () => {
    resolveStrictModeDetection(true)
    resolveStrictModeDetection(false)
    await expect(awaitStrictModeDetection()).resolves.toBe(true)
  })

  it('resolves a genuine negative as false, which is a verified observation', async () => {
    resolveStrictModeDetection(false)
    await expect(awaitStrictModeDetection()).resolves.toBe(false)
  })

  it('times out to inconclusive, never to false, since a silent probe proves nothing', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const pending = awaitStrictModeDetection(50)
    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toBe('inconclusive')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a late probe report after the timeout does not retroactively change an already-resolved read', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const pending = awaitStrictModeDetection(50)
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBe('inconclusive')

    // The probe finally reports after the timeout fallback already fired. Because the
    // fallback did not itself call resolveStrictModeDetection, a genuinely late probe still
    // wins and becomes the answer for anyone who asks afterward.
    resolveStrictModeDetection(true)
    await expect(awaitStrictModeDetection()).resolves.toBe(true)
  })
})
