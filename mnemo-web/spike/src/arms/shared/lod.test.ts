// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARKER_RUNG,
  bandForZoom,
  createLodController,
  isMarkerRung,
  readMarkerRung,
} from './lod'

describe('bandForZoom', () => {
  it('matches the shipped desktop thresholds at their boundaries', () => {
    expect(bandForZoom(1)).toBe('full')
    expect(bandForZoom(0.4)).toBe('full')
    expect(bandForZoom(0.399)).toBe('labels')
    expect(bandForZoom(0.15)).toBe('labels')
    expect(bandForZoom(0.149)).toBe('bare')
    // The zoom the all-visible scenario actually lands on.
    expect(bandForZoom(0.132)).toBe('bare')
  })
})

describe('readMarkerRung', () => {
  it('defaults to the rung that reproduces the existing measurements', () => {
    expect(readMarkerRung(new URLSearchParams(''))).toBe(DEFAULT_MARKER_RUNG)
    expect(readMarkerRung(new URLSearchParams('rung='))).toBe(DEFAULT_MARKER_RUNG)
    expect(DEFAULT_MARKER_RUNG).toBe(4)
  })

  it('reads every rung on the ladder', () => {
    for (const rung of [0, 1, 2, 3, 4]) {
      expect(readMarkerRung(new URLSearchParams(`rung=${rung}`))).toBe(rung)
    }
  })

  /**
   * The whole point of the ladder is that the report's label matches what was rendered. A value
   * that silently fell back would measure rung 4 under a heading saying rung 0, which is the one
   * failure mode that would make the go/no-go decision confidently wrong.
   */
  it('throws rather than falling back on anything it does not recognise', () => {
    for (const bad of ['5', '-1', '0.5', 'zero', 'marker', ' ']) {
      expect(() => readMarkerRung(new URLSearchParams(`rung=${bad}`))).toThrow(/unknown \?rung=/)
    }
  })

  it('rejects non-integers and out-of-range values at the predicate', () => {
    expect(isMarkerRung(0)).toBe(true)
    expect(isMarkerRung(4)).toBe(true)
    expect(isMarkerRung(5)).toBe(false)
    expect(isMarkerRung(-1)).toBe(false)
    expect(isMarkerRung(1.5)).toBe(false)
    expect(isMarkerRung(Number.NaN)).toBe(false)
  })
})

describe('createLodController', () => {
  it('writes the rung once, as an attribute CSS can key the whole ladder off', () => {
    const container = document.createElement('div')
    createLodController(container, true, 0)
    expect(container.getAttribute('data-rung')).toBe('0')
    expect(container.getAttribute('data-lod')).toBe('full')
  })

  it('leaves an unparameterized arm on the rung every prior run measured', () => {
    const container = document.createElement('div')
    createLodController(container, true)
    expect(container.getAttribute('data-rung')).toBe(String(DEFAULT_MARKER_RUNG))
  })

  it('reports a band change only when the band actually changes', () => {
    const container = document.createElement('div')
    const lod = createLodController(container, true, 0)

    expect(lod.update(1)).toBe(false)
    expect(lod.update(0.5)).toBe(false)
    expect(lod.update(0.3)).toBe(true)
    expect(container.getAttribute('data-lod')).toBe('labels')
    expect(lod.update(0.2)).toBe(false)
    expect(lod.update(0.132)).toBe(true)
    expect(container.getAttribute('data-lod')).toBe('bare')
  })

  it('pins the band to full when disabled, so the diagnostic arm stays honest', () => {
    const container = document.createElement('div')
    const lod = createLodController(container, false, 0)

    lod.update(0.132)
    expect(container.getAttribute('data-lod')).toBe('full')
    expect(lod.isEnabled()).toBe(false)
  })
})
