// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { assertConfounders, captureEnvironment, watchVisibility } from './env'
import type { EnvironmentFacts } from './contract'
import { resetStrictModeDetectionForTests, resolveStrictModeDetection } from './strict-mode-detection'

function cleanFacts(overrides: Partial<EnvironmentFacts> = {}): EnvironmentFacts {
  return {
    userAgent: 'test-agent',
    hardwareConcurrency: 8,
    devicePixelRatio: 1,
    viewportWidth: 1600,
    viewportHeight: 900,
    isProductionBuild: true,
    strictModeDetected: false,
    eventTimingAvailable: true,
    supportedEntryTypes: ['event'],
    rasterizer: 'Fake GPU',
    contentVisibilitySupported: true,
    heapUsedBytes: null,
    ...overrides,
  }
}

function setVisibilityState(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

beforeEach(() => {
  resetStrictModeDetectionForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setVisibilityState('visible')
})

describe('captureEnvironment', () => {
  it('relays ambient platform facts without transforming them', async () => {
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.userAgent).toBe(navigator.userAgent)
    expect(env.hardwareConcurrency).toBe(navigator.hardwareConcurrency)
    expect(env.devicePixelRatio).toBe(window.devicePixelRatio)
    expect(env.viewportWidth).toBe(window.innerWidth)
    expect(env.viewportHeight).toBe(window.innerHeight)
    expect(env.isProductionBuild).toBe(import.meta.env.PROD)
  })

  it('records strictModeDetected as inconclusive, never false, when the probe never reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.strictModeDetected).toBe('inconclusive')
    expect(warn).toHaveBeenCalled()
  })

  it('reflects a genuine StrictModeProbe observation instead of the inconclusive fallback', async () => {
    resolveStrictModeDetection(true)
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.strictModeDetected).toBe(true)
  })

  it('records a verified negative as false, distinct from a probe that never reported', async () => {
    resolveStrictModeDetection(false)
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.strictModeDetected).toBe(false)
  })

  it('derives eventTimingAvailable from supportedEntryTypes rather than assuming it', async () => {
    class WithEvent {
      static supportedEntryTypes = ['event', 'paint']
    }
    vi.stubGlobal('PerformanceObserver', WithEvent)
    const withEvent = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(withEvent.eventTimingAvailable).toBe(true)
    expect(withEvent.supportedEntryTypes).toEqual(['event', 'paint'])

    class WithoutEvent {
      static supportedEntryTypes = ['paint']
    }
    vi.stubGlobal('PerformanceObserver', WithoutEvent)
    const withoutEvent = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(withoutEvent.eventTimingAvailable).toBe(false)
  })

  it('reports supportedEntryTypes as empty, not a throw, when PerformanceObserver is absent', async () => {
    vi.stubGlobal('PerformanceObserver', undefined)
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.supportedEntryTypes).toEqual([])
    expect(env.eventTimingAvailable).toBe(false)
  })

  it('reads the rasterizer through WEBGL_debug_renderer_info and cleans the context up', async () => {
    const loseContext = vi.fn()
    const fakeGl = {
      getExtension: (name: string) => {
        if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 0x9246 }
        if (name === 'WEBGL_lose_context') return { loseContext }
        return null
      },
      getParameter: () => 'Fake Renderer 9000',
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeGl as never)

    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.rasterizer).toBe('Fake Renderer 9000')
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('reports rasterizer as null, feature-detected, when the debug extension is unavailable', async () => {
    const fakeGl = { getExtension: () => null, getParameter: () => 'irrelevant' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeGl as never)
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.rasterizer).toBeNull()
  })

  it('reports rasterizer as null, not a throw, when no WebGL context is available at all', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.rasterizer).toBeNull()
  })

  it('reads content-visibility support through CSS.supports when CSS exists', async () => {
    vi.stubGlobal('CSS', { supports: (prop: string, value: string) => prop === 'content-visibility' && value === 'auto' })
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.contentVisibilitySupported).toBe(true)
  })

  it('reports content-visibility as unsupported, not a throw, when CSS.supports is absent (jsdom)', async () => {
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.contentVisibilitySupported).toBe(false)
  })

  it('reads heapUsedBytes from performance.memory when present and numeric', async () => {
    vi.stubGlobal('performance', Object.assign(Object.create(performance), { memory: { usedJSHeapSize: 12_345 } }))
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.heapUsedBytes).toBe(12_345)
  })

  it('reports heapUsedBytes as null, never load-bearing, when performance.memory is absent', async () => {
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.heapUsedBytes).toBeNull()
  })

  it('guards against a malformed memory shape instead of trusting it', async () => {
    vi.stubGlobal('performance', Object.assign(Object.create(performance), { memory: { usedJSHeapSize: 'not-a-number' } }))
    const env = await captureEnvironment({ strictModeTimeoutMs: 5 })
    expect(env.heapUsedBytes).toBeNull()
  })
})

describe('assertConfounders', () => {
  it('reports no violations for a clean environment', () => {
    expect(assertConfounders(cleanFacts())).toEqual([])
  })

  it('flags a non-production build', () => {
    const violations = assertConfounders(cleanFacts({ isProductionBuild: false }))
    expect(violations).toEqual(['not a production build: import.meta.env.PROD is false'])
  })

  it('flags active StrictMode', () => {
    const violations = assertConfounders(cleanFacts({ strictModeDetected: true }))
    expect(violations.some((v) => v.includes('StrictMode'))).toBe(true)
  })

  it('flags an unverified StrictMode read, which is the confounder the check exists for', () => {
    const violations = assertConfounders(cleanFacts({ strictModeDetected: 'inconclusive' }))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/could not be verified/)
  })

  it('accepts only a verified negative as clean', () => {
    expect(assertConfounders(cleanFacts({ strictModeDetected: false }))).toEqual([])
  })

  it('flags a viewport that is not exactly 1600x900 and names the actual size', () => {
    const violations = assertConfounders(cleanFacts({ viewportWidth: 1280, viewportHeight: 900 }))
    expect(violations).toEqual(['viewport is 1280x900, expected exactly 1600x900 CSS px'])
  })

  it('does not flag missing Event Timing: it corroborates, and no gating metric may need it', () => {
    expect(assertConfounders(cleanFacts({ eventTimingAvailable: false }))).toEqual([])
  })

  it('reports every violation at once rather than stopping at the first', () => {
    const violations = assertConfounders(
      cleanFacts({ isProductionBuild: false, strictModeDetected: true, viewportWidth: 1280 }),
    )
    expect(violations).toHaveLength(3)
  })
})

describe('watchVisibility', () => {
  it('never fires while the document stays visible', () => {
    vi.useFakeTimers()
    const onLost = vi.fn()
    const stop = watchVisibility(onLost, 50)
    vi.advanceTimersByTime(500)
    stop()
    expect(onLost).not.toHaveBeenCalled()
  })

  it('fires on a visibilitychange event the moment the document is hidden', () => {
    const onLost = vi.fn()
    const stop = watchVisibility(onLost, 100_000)
    setVisibilityState('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(onLost).toHaveBeenCalledWith('hidden')
    stop()
  })

  it('also catches a hidden document by polling, for a host that never fires the event', () => {
    vi.useFakeTimers()
    const onLost = vi.fn()
    const stop = watchVisibility(onLost, 50)
    setVisibilityState('hidden')
    vi.advanceTimersByTime(50)
    expect(onLost).toHaveBeenCalledWith('hidden')
    stop()
  })

  it('stops reporting once disposed', () => {
    vi.useFakeTimers()
    const onLost = vi.fn()
    const stop = watchVisibility(onLost, 50)
    stop()
    setVisibilityState('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(500)
    expect(onLost).not.toHaveBeenCalled()
  })
})
