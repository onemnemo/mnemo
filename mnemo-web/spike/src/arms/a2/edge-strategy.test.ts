import { describe, expect, it } from 'vitest'

import {
  HYBRID_ENTER_OVERVIEW_ZOOM,
  HYBRID_LEAVE_OVERVIEW_ZOOM,
  createEdgeStrategySelector,
  initialHybridMode,
} from './edge-strategy'

describe('initialHybridMode', () => {
  it('starts on the substrate the starting zoom was measured to need', () => {
    expect(initialHybridMode(1)).toBe('canvas')
    expect(initialHybridMode(0.5)).toBe('canvas')
    expect(initialHybridMode(HYBRID_ENTER_OVERVIEW_ZOOM)).toBe('canvas')
    expect(initialHybridMode(0.132)).toBe('svg')
    expect(initialHybridMode(0.1)).toBe('svg')
  })
})

describe('createEdgeStrategySelector', () => {
  it('never switches when a substrate is pinned', () => {
    for (const pinned of ['svg', 'canvas', 'off'] as const) {
      const sel = createEdgeStrategySelector(pinned, 1)
      expect(sel.current()).toBe(pinned)
      for (const zoom of [1, 0.4, 0.15, 0.132, 0.1]) expect(sel.update(zoom)).toBeNull()
      expect(sel.current()).toBe(pinned)
    }
  })

  it('switches to svg on entering the overview band and back on leaving it', () => {
    const sel = createEdgeStrategySelector('hybrid', 1)
    expect(sel.current()).toBe('canvas')

    expect(sel.update(0.5)).toBeNull()
    expect(sel.update(0.2)).toBeNull()
    expect(sel.update(0.132)).toBe('svg')
    expect(sel.current()).toBe('svg')

    expect(sel.update(0.1)).toBeNull()
    expect(sel.update(HYBRID_LEAVE_OVERVIEW_ZOOM)).toBe('canvas')
    expect(sel.current()).toBe('canvas')
  })

  /**
   * The failure this guards is not subtle: without the gap, a camera resting on the threshold
   * tears both layers down and rebuilds them on every jittered frame of a zoom gesture.
   */
  it('does not flap when the zoom oscillates inside the hysteresis gap', () => {
    const sel = createEdgeStrategySelector('hybrid', 1)
    sel.update(0.1)
    expect(sel.current()).toBe('svg')

    // Above the entry threshold but below the exit threshold: still svg, every time.
    for (const zoom of [0.151, 0.16, 0.169, 0.155, 0.16]) {
      expect(sel.update(zoom)).toBeNull()
      expect(sel.current()).toBe('svg')
    }
  })

  it('reports a switch exactly once per crossing, not once per frame past it', () => {
    const sel = createEdgeStrategySelector('hybrid', 1)
    expect(sel.update(0.14)).toBe('svg')
    expect(sel.update(0.13)).toBeNull()
    expect(sel.update(0.12)).toBeNull()
    expect(sel.update(0.2)).toBe('canvas')
    expect(sel.update(0.3)).toBeNull()
  })

  it('keeps the entry threshold on the level-of-detail boundary so the two never disagree', () => {
    expect(HYBRID_ENTER_OVERVIEW_ZOOM).toBe(0.15)
    expect(HYBRID_LEAVE_OVERVIEW_ZOOM).toBeGreaterThan(HYBRID_ENTER_OVERVIEW_ZOOM)
  })
})
