import { describe, expect, it } from 'vitest'

import { MAX_SCALE, MIN_SCALE } from '../model/scene'
import { clampZoom, panBy, worldTransform, zoomAt } from './camera'

describe('worldTransform', () => {
  it('composes to a matrix the shared parser reads back as the same camera', () => {
    // Not a formatting test. The committed-versus-state proof compares these two, so a
    // transform written in the wrong order agrees with the state at zoom 1.0 and silently
    // disagrees everywhere else, which is exactly where the scenarios run.
    const viewport = { x: 120, y: -40, zoom: 0.25 }
    expect(worldTransform(viewport)).toBe('translate(-30px, 10px) scale(0.25)')
  })

  it('places the camera origin at the viewport top-left', () => {
    // A canvas point at the camera origin must land at screen 0,0: screen = (p - origin) * zoom
    // plus the translation, so the translation has to be -origin * zoom.
    const viewport = { x: 200, y: 300, zoom: 2 }
    expect(worldTransform(viewport)).toBe('translate(-400px, -600px) scale(2)')
  })
})

describe('panBy', () => {
  it('moves the camera opposite the drag, scaled down by zoom', () => {
    // Grab and pan: dragging the surface right shows content further left.
    expect(panBy({ x: 0, y: 0, zoom: 2 }, 100, 50)).toEqual({ x: -50, y: -25, zoom: 2 })
  })

  it('leaves zoom untouched', () => {
    expect(panBy({ x: 1, y: 2, zoom: 0.37 }, 5, 5).zoom).toBe(0.37)
  })
})

describe('zoomAt', () => {
  it('keeps the canvas point under the cursor fixed', () => {
    const before = { x: 100, y: 100, zoom: 1 }
    const offsetX = 300
    const offsetY = 200
    const underCursor = {
      x: before.x + offsetX / before.zoom,
      y: before.y + offsetY / before.zoom,
    }

    const after = zoomAt(before, -240, offsetX, offsetY)

    expect(after.zoom).toBeGreaterThan(before.zoom)
    expect(after.x + offsetX / after.zoom).toBeCloseTo(underCursor.x, 9)
    expect(after.y + offsetY / after.zoom).toBeCloseTo(underCursor.y, 9)
  })

  it('zooms in on negative deltaY, matching the pinch-as-ctrl-wheel convention', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, -100, 0, 0).zoom).toBeGreaterThan(1)
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 100, 0, 0).zoom).toBeLessThan(1)
  })

  it('clamps to the desktop camera limits and stops moving there', () => {
    const atFloor = zoomAt({ x: 10, y: 10, zoom: MIN_SCALE }, 5000, 100, 100)
    expect(atFloor.zoom).toBe(MIN_SCALE)
    // Returning the same camera rather than a re-anchored one matters: a clamped zoom that
    // still shifted the origin would drift the view every frame the sweep spends at a limit.
    expect(atFloor).toEqual({ x: 10, y: 10, zoom: MIN_SCALE })
    expect(zoomAt({ x: 0, y: 0, zoom: MAX_SCALE }, -5000, 0, 0).zoom).toBe(MAX_SCALE)
  })

  it('is the exponential model the driver fits its sweep against', () => {
    // Anything that aims a zoom (a fit animation, a test driver) probes once and extrapolates.
    // If the mapping is not exponential in deltaY the extrapolation is wrong everywhere except at
    // the probe, and a sweep silently tracks off schedule.
    const start = { x: 0, y: 0, zoom: 0.4 }
    const probed = zoomAt(start, -120, 0, 0)
    const sensitivity = -Math.log(probed.zoom / start.zoom) / -120

    const target = 0.9
    const delta = -Math.log(target / start.zoom) / sensitivity
    expect(zoomAt(start, delta, 0, 0).zoom).toBeCloseTo(target, 9)
  })
})

describe('clampZoom', () => {
  it('holds the camera limits', () => {
    expect(clampZoom(0.01)).toBe(MIN_SCALE)
    expect(clampZoom(99)).toBe(MAX_SCALE)
    expect(clampZoom(1)).toBe(1)
  })
})
