import { describe, expect, it } from 'vitest'

import type { FrameSample } from './contract'
import {
  canvasPointToClient,
  clientPointToCanvas,
  defaultPanDeltaToViewportDelta,
  findZoomCrossings,
  fitWheelSensitivity,
  framesInWindow,
  interpolateZoomLog,
  pointDelta,
  pressPointCandidates,
  wheelDeltaForZoomRatio,
  withinTolerance,
  worstFrameDtInWindow,
  type ZoomSample,
} from './driver-geometry'

describe('canvasPointToClient', () => {
  it('maps the viewport origin to the container origin at zoom 1', () => {
    const client = canvasPointToClient({ left: 100, top: 50 }, { x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 })
    expect(client).toEqual({ x: 100, y: 50 })
  })

  it('scales by zoom and offsets by the viewport origin', () => {
    const client = canvasPointToClient({ left: 0, top: 0 }, { x: 200, y: 100, zoom: 2 }, { x: 250, y: 130 })
    // (250-200)*2 = 100, (130-100)*2 = 60
    expect(client).toEqual({ x: 100, y: 60 })
  })
})

describe('clientPointToCanvas', () => {
  it('is the exact inverse of canvasPointToClient', () => {
    const origin = { left: 37, top: 11 }
    const viewport = { x: 200, y: 100, zoom: 0.35 }
    const canvas = { x: 812.5, y: -44.25 }
    const round = clientPointToCanvas(origin, viewport, canvasPointToClient(origin, viewport, canvas))
    expect(round.x).toBeCloseTo(canvas.x, 9)
    expect(round.y).toBeCloseTo(canvas.y, 9)
  })
})

describe('pressPointCandidates', () => {
  const rect = { left: 0, top: 0, width: 1600, height: 900 }

  it('offers the centre first and then spreads outward', () => {
    const candidates = pressPointCandidates(rect)
    expect(candidates[0]).toEqual({ x: 800, y: 450 })
    expect(candidates.length).toBeGreaterThan(10)
  })

  it('keeps every candidate inside the container and off its edges', () => {
    for (const point of pressPointCandidates(rect)) {
      expect(point.x).toBeGreaterThan(rect.left + 10)
      expect(point.x).toBeLessThan(rect.left + rect.width - 10)
      expect(point.y).toBeGreaterThan(rect.top + 10)
      expect(point.y).toBeLessThan(rect.top + rect.height - 10)
    }
  })

  it('is deterministic, so a rerun presses where the previous run pressed', () => {
    expect(pressPointCandidates(rect)).toEqual(pressPointCandidates(rect))
  })

  it('offsets by the container origin rather than assuming the page corner', () => {
    expect(pressPointCandidates({ left: 100, top: 40, width: 200, height: 100 })[0]).toEqual({
      x: 200,
      y: 90,
    })
  })
})

describe('defaultPanDeltaToViewportDelta', () => {
  it('inverts a screen-space drag into the opposite canvas-space delta at zoom 1', () => {
    expect(defaultPanDeltaToViewportDelta(100, -40, 1)).toEqual({ x: -100, y: 40 })
  })

  it('divides by zoom, so the same screen drag moves the camera less when zoomed in', () => {
    expect(defaultPanDeltaToViewportDelta(100, 20, 2)).toEqual({ x: -50, y: -10 })
  })
})

describe('withinTolerance', () => {
  const tolerance = { relative: 0.1, absoluteFloor: 1 }

  it('accepts a match inside the relative band', () => {
    expect(withinTolerance(100, 108, tolerance)).toBe(true)
  })

  it('rejects a value outside the relative band', () => {
    expect(withinTolerance(100, 120, tolerance)).toBe(false)
  })

  it('falls back to the absolute floor near zero, where a relative band would be meaninglessly tight', () => {
    // 10% of 0 is 0, so without a floor even a 0.5 deviation from an expected 0 would fail
    expect(withinTolerance(0, 0.5, tolerance)).toBe(true)
    expect(withinTolerance(0, 2, tolerance)).toBe(false)
  })
})

describe('pointDelta', () => {
  it('subtracts before from after', () => {
    expect(pointDelta({ x: 10, y: 20 }, { x: 4, y: 25 })).toEqual({ x: -6, y: 5 })
  })
})

describe('interpolateZoomLog', () => {
  it('returns the endpoints at fraction 0 and 1', () => {
    expect(interpolateZoomLog(0.1, 1.0, 0)).toBeCloseTo(0.1, 10)
    expect(interpolateZoomLog(0.1, 1.0, 1)).toBeCloseTo(1.0, 10)
  })

  it('is monotonic across the sweep', () => {
    const values = Array.from({ length: 11 }, (_, i) => interpolateZoomLog(0.1, 1.0, i / 10))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })

  it('spaces zoom evenly on a log scale, not a linear one', () => {
    // the midpoint should be the geometric mean, not the arithmetic mean
    const mid = interpolateZoomLog(0.1, 1.0, 0.5)
    expect(mid).toBeCloseTo(Math.sqrt(0.1 * 1.0), 10)
  })
})

describe('fitWheelSensitivity and wheelDeltaForZoomRatio', () => {
  it('round-trips: a delta computed from a fitted sensitivity reproduces the probe response', () => {
    const k = 0.003
    const zoomBefore = 0.2
    const probeDeltaY = -100
    const zoomAfter = zoomBefore * Math.exp(k * probeDeltaY * -1) // ln(after/before) = -k*deltaY per the model
    const sensitivity = fitWheelSensitivity(probeDeltaY, zoomBefore, zoomAfter)
    expect(sensitivity).toBeCloseTo(k, 6)

    const target = 0.5
    const deltaY = wheelDeltaForZoomRatio(zoomAfter, target, sensitivity)
    const predicted = zoomAfter * Math.exp(-sensitivity * deltaY)
    expect(predicted).toBeCloseTo(target, 6)
  })

  it('returns 0 sensitivity for a probe that produced no measurable response', () => {
    expect(fitWheelSensitivity(-100, 0.5, 0.5)).toBe(0)
    expect(fitWheelSensitivity(0, 0.5, 0.6)).toBe(0)
  })

  it('returns 0 deltaY when sensitivity is 0, rather than dividing by it', () => {
    expect(wheelDeltaForZoomRatio(0.5, 1.0, 0)).toBe(0)
  })
})

describe('findZoomCrossings', () => {
  it('finds a single upward crossing of one threshold', () => {
    const samples: ZoomSample[] = [
      { t: 0, zoom: 0.1 },
      { t: 10, zoom: 0.12 },
      { t: 20, zoom: 0.18 },
      { t: 30, zoom: 0.25 },
    ]
    const crossings = findZoomCrossings(samples, [0.15])
    expect(crossings).toHaveLength(1)
    expect(crossings[0]).toMatchObject({ thresholdZoom: 0.15, direction: 'up', fromZoom: 0.12, toZoom: 0.18 })
  })

  it('finds both legs of a round-trip sweep, for both LOD thresholds', () => {
    const samples: ZoomSample[] = [
      { t: 0, zoom: 0.1 },
      { t: 10, zoom: 0.2 }, // crosses 0.15 up
      { t: 20, zoom: 0.5 }, // crosses 0.4 up
      { t: 30, zoom: 1.0 },
      { t: 40, zoom: 0.5 },
      { t: 50, zoom: 0.2 }, // crosses 0.4 down
      { t: 60, zoom: 0.1 }, // crosses 0.15 down
    ]
    const crossings = findZoomCrossings(samples, [0.15, 0.4])
    const byThresholdAndDirection = crossings.map((c) => `${c.thresholdZoom}:${c.direction}`)
    expect(byThresholdAndDirection).toEqual(['0.15:up', '0.4:up', '0.4:down', '0.15:down'])
  })

  it('reports no crossing for a sweep that never reaches the threshold', () => {
    const samples: ZoomSample[] = [
      { t: 0, zoom: 0.1 },
      { t: 10, zoom: 0.12 },
      { t: 20, zoom: 0.13 },
    ]
    expect(findZoomCrossings(samples, [0.4])).toEqual([])
  })

  it('treats landing exactly on the threshold as having crossed it', () => {
    const samples: ZoomSample[] = [
      { t: 0, zoom: 0.1 },
      { t: 10, zoom: 0.15 },
    ]
    expect(findZoomCrossings(samples, [0.15])).toHaveLength(1)
  })
})

describe('framesInWindow and worstFrameDtInWindow', () => {
  const frames: FrameSample[] = [
    { t: 1000, dt: 16, phase: 'driven' },
    { t: 1016, dt: 16, phase: 'driven' },
    { t: 1120, dt: 104, phase: 'driven' },
    { t: 1200, dt: 16, phase: 'driven' },
  ]

  it('selects the samples inside a crossing window, endpoints included', () => {
    expect(framesInWindow(frames, 1016, 1120).map((f) => f.t)).toEqual([1016, 1120])
  })

  it('reports the worst delta in the window, which is S5x\'s whole quantity', () => {
    expect(worstFrameDtInWindow(frames, 1016, 1120)).toBe(104)
    expect(worstFrameDtInWindow(frames, 1180, 1210)).toBe(16)
  })

  it('reports null rather than 0 for a window with no samples, because missing is not perfect', () => {
    expect(worstFrameDtInWindow(frames, 2000, 3000)).toBeNull()
  })

  it('joins on the absolute clock: a window offset by the sweep start selects nothing', () => {
    // The failure this exists to prevent: relative sweep times against absolute frame times.
    expect(framesInWindow(frames, 16, 120)).toEqual([])
  })
})
