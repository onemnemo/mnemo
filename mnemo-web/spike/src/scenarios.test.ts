// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import {
  SCENARIO_PLANS,
  SCENARIO_SPECS,
  applyScenarioViewport,
  createOccupancyTest,
  isScenarioId,
  worstFrameDeltaMs,
  type ScenarioContext,
  type ScenarioPlan,
} from './scenarios'
import type {
  ArmHandle,
  FrameSample,
  MoveOpLike,
  OnScreenCounts,
  Point,
  ScenarioId,
  Viewport,
} from './harness/contract'
import type { ElementContent, MindmapElement, MindmapFixture } from './fixture/model'
import { boundsOf } from './fixture/model'
import type { FixtureRoles } from './fixture/generate'
import { GestureDriver, ProofLedger } from './harness/driver'
import { createEventTimingObserver, createFrameSampler } from './harness/measure'
import { thresholds } from './harness/verdict'

const VIEWPORT_WIDTH = 1600
const VIEWPORT_HEIGHT = 900

// ---- fixture builders ----------------------------------------------------------------------

function element(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 50,
  content: ElementContent = { kind: 'text', text: id },
): MindmapElement {
  return { id, kind: content.kind === 'frame' ? 'frame' : 'node', content, x, y, width, height }
}

function fixtureOf(elements: readonly MindmapElement[]): MindmapFixture {
  return {
    id: 'test-fixture',
    layout: 'forest',
    elements,
    edges: [],
    clusterRoots: [],
    parentOf: {},
    bounds: boundsOf(elements),
    digest: 'test-digest',
  }
}

function emptyRoles(overrides: Partial<FixtureRoles> = {}): FixtureRoles {
  return {
    containingFrameIds: [],
    detachedFrameIds: [],
    crossClusterFrameIds: [],
    outsideRectFrameIds: [],
    mixedKindFrameIds: [],
    groupDragFrameIds: [],
    orphanElementIds: [],
    ...overrides,
  }
}

/**
 * Elements spread evenly over `width` by `height`, so a camera pointed anywhere inside the
 * content sees something. A fixture with only corner elements would let a mispointed camera
 * report zero on screen for the right reason and pass for the wrong one.
 */
function gridFixture(width: number, height: number, step = 500): MindmapFixture {
  const elements: MindmapElement[] = []
  for (let x = 0; x + 100 <= width; x += step) {
    for (let y = 0; y + 50 <= height; y += step) {
      elements.push(element(`e${x}_${y}`, x, y))
    }
  }
  return fixtureOf(elements)
}

/** The canvas rect a camera can see, in the contract's canvas-space convention. */
function visibleRect(viewport: Viewport): { left: number; top: number; right: number; bottom: number } {
  return {
    left: viewport.x,
    top: viewport.y,
    right: viewport.x + VIEWPORT_WIDTH / viewport.zoom,
    bottom: viewport.y + VIEWPORT_HEIGHT / viewport.zoom,
  }
}

function visibleCentre(viewport: Viewport): Point {
  const rect = visibleRect(viewport)
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
}

function centreOfBounds(fixture: MindmapFixture): Point {
  const { minX, minY, maxX, maxY } = fixture.bounds
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

function planFor(id: ScenarioId): ScenarioPlan {
  return SCENARIO_PLANS[id]
}

function viewportFor(id: ScenarioId, fixture: MindmapFixture, roles = emptyRoles()): Viewport {
  return planFor(id).planViewport({
    fixture,
    roles,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
  })
}

// ---- fake arm ------------------------------------------------------------------------------

interface FakeArmOptions {
  /**
   * Reproduces an arm that stores the viewport as a screen-space translation while the contract
   * specifies a canvas-space origin. It accepts every number happily and renders blank space,
   * which is the failure the on-screen proof exists to catch.
   */
  readonly misreadViewportConvention?: boolean
}

function createFakeArm(fixture: MindmapFixture, options: FakeArmOptions = {}): ArmHandle {
  let viewport: Viewport = { x: 0, y: 0, zoom: 1 }
  let lodEnabled = true
  const host = document.createElement('div')
  const inner = document.createElement('div')
  host.appendChild(inner)
  document.body.appendChild(host)

  const cameraOrigin = (): Point =>
    options.misreadViewportConvention
      ? { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom }
      : { x: viewport.x, y: viewport.y }

  return {
    id: 'a1-reactflow',
    getViewport: () => viewport,
    setViewport: (next) => {
      viewport = next
    },
    getElementPosition: (id) => {
      const found = fixture.elements.find((candidate) => candidate.id === id)
      return found ? { x: found.x, y: found.y } : undefined
    },
    getTransformTarget: () => inner,
    readCommittedViewport: () => viewport,
    getGestureTarget: () => host,
    setLodEnabled: (enabled) => {
      lodEnabled = enabled
    },
    isLodEnabled: () => lodEnabled,
    getOnScreenCounts: (): OnScreenCounts => {
      const origin = cameraOrigin()
      const width = VIEWPORT_WIDTH / viewport.zoom
      const height = VIEWPORT_HEIGHT / viewport.zoom
      let elements = 0
      for (const candidate of fixture.elements) {
        if (
          candidate.x < origin.x + width &&
          candidate.x + candidate.width > origin.x &&
          candidate.y < origin.y + height &&
          candidate.y + candidate.height > origin.y
        ) {
          elements += 1
        }
      }
      return { elements, edges: 0, domNodes: 1 }
    },
    setSelection: () => {},
    applyRelayout: () => Promise.resolve(),
    drainPendingOps: (): readonly MoveOpLike[] => [],
    dispose: () => {
      host.remove()
    },
  }
}

function contextFor(plan: ScenarioPlan, fixture: MindmapFixture, arm: ArmHandle, roles = emptyRoles()): ScenarioContext {
  const ledger = new ProofLedger()
  return {
    spec: plan.spec,
    arm,
    fixture,
    roles,
    driver: new GestureDriver(arm, { ledger, win: window }),
    ledger,
    sampler: createFrameSampler(),
    win: window,
    seed: 1,
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    mountMs: 0,
    mountLongestBlockMs: 0,
    eventTiming: createEventTimingObserver(),
  }
}

// ---- specs -----------------------------------------------------------------------------------

describe('scenario specs', () => {
  const ids = Object.keys(SCENARIO_SPECS) as ScenarioId[]

  it('registers a plan for every scenario, keyed by its own id', () => {
    for (const id of ids) {
      expect(SCENARIO_PLANS[id].spec.id).toBe(id)
      expect(SCENARIO_SPECS[id].id).toBe(id)
    }
  })

  it('carries the same gating flag as thresholds.json', () => {
    for (const id of ids) {
      if (id === 'control') continue
      expect(SCENARIO_SPECS[id].gating).toBe(thresholds.scenarios[id].gating)
    }
  })

  it('measures the all-visible and typing scenarios on the dense grid, everything else on the forest', () => {
    expect(SCENARIO_SPECS.S4a.layout).toBe('dense-grid')
    expect(SCENARIO_SPECS.S4b.layout).toBe('dense-grid')
    expect(SCENARIO_SPECS.S8.layout).toBe('dense-grid')
    expect(SCENARIO_SPECS.S2.layout).toBe('forest')
    expect(SCENARIO_SPECS.S9.layout).toBe('forest')
  })

  it('forces level of detail off for the diagnostic arm only', () => {
    expect(SCENARIO_SPECS.S4b.lodEnabled).toBe(false)
    for (const id of ids) {
      if (id === 'S4b') continue
      expect(SCENARIO_SPECS[id].lodEnabled).toBe(true)
    }
  })

  it('runs the control at 100 elements and everything else at 5000', () => {
    expect(SCENARIO_SPECS.control.elementCount).toBe(100)
    for (const id of ids) {
      if (id === 'control') continue
      expect(SCENARIO_SPECS[id].elementCount).toBe(5000)
    }
  })

  it('accepts only real scenario ids', () => {
    expect(isScenarioId('S4a')).toBe(true)
    expect(isScenarioId('control')).toBe(true)
    expect(isScenarioId('S4')).toBe(false)
    expect(isScenarioId('toString')).toBe(false)
  })
})

describe('declared proof minimums', () => {
  it('never falls below the two camera proofs every scenario records', () => {
    for (const id of Object.keys(SCENARIO_PLANS) as ScenarioId[]) {
      expect(SCENARIO_PLANS[id].minimumProofs).toBeGreaterThanOrEqual(2)
    }
  })

  it('demands the extra proofs the multi-gesture scenarios owe', () => {
    // The group drag owes its member delta-equality proof on top of a plain drag's two, and the
    // control owes a full set from each of its two gestures. A regression that dropped either
    // would otherwise seal cleanly on a partial run.
    expect(SCENARIO_PLANS.S7.minimumProofs).toBeGreaterThan(SCENARIO_PLANS.S6.minimumProofs)
    expect(SCENARIO_PLANS.control.minimumProofs).toBeGreaterThan(SCENARIO_PLANS.S2.minimumProofs)
    expect(SCENARIO_PLANS.S5x.minimumProofs).toBeGreaterThan(SCENARIO_PLANS.S5.minimumProofs)
  })
})

// ---- cameras ------------------------------------------------------------------------------------

/** The centre of the element nearest `point`, which is what the pan planner anchors on. */
function nearestElementCentre(fixture: MindmapFixture, point: { x: number; y: number }) {
  let best = fixture.elements[0]
  let bestDistance = Infinity
  for (const element of fixture.elements) {
    const cx = element.x + element.width / 2
    const cy = element.y + element.height / 2
    const distance = (cx - point.x) ** 2 + (cy - point.y) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = element
    }
  }
  return { x: best.x + best.width / 2, y: best.y + best.height / 2 }
}

describe('planViewport', () => {
  it('centres the non-panning scenarios on the content, at the scenario zoom', () => {
    const fixture = gridFixture(20_000, 20_000)
    const centre = centreOfBounds(fixture)

    const s6 = viewportFor('S6', fixture)
    expect(s6.zoom).toBe(1)
    expect(visibleCentre(s6).x).toBeCloseTo(centre.x, 6)
    expect(visibleCentre(s6).y).toBeCloseTo(centre.y, 6)

    expect(viewportFor('S5', fixture).zoom).toBeCloseTo(0.1, 6)
    expect(viewportFor('S8', fixture).zoom).toBeCloseTo(0.5, 6)
    expect(viewportFor('S3', fixture).zoom).toBeCloseTo(0.1, 6)
  })

  it('starts a pan half its travel before its anchor, so the window is symmetric about it', () => {
    const fixture = gridFixture(20_000, 20_000)
    const start = visibleCentre(viewportFor('S2', fixture))

    // The anchor is the element nearest the content centre, not the centre itself: on a
    // clustered fixture the geometric centre is usually a gutter, and a pan opening there
    // measures a viewport with nothing in it. 600 px/s over the ten second measured window at
    // zoom 1 is 6000 canvas units of travel, and the camera opens on the first half of it.
    const anchor = nearestElementCentre(fixture, centreOfBounds(fixture))
    expect(anchor.x - start.x).toBeCloseTo(3_000, 6)
    expect(anchor.y - start.y).toBeCloseTo(3_000, 6)
  })

  it('clamps pan travel to the fixture, so the camera never ends over blank canvas', () => {
    // Barely wider than the view at zoom 1, so the full 6000 units of travel cannot be planned:
    // a pan that long would spend most of the measured window over empty canvas.
    const fixture = gridFixture(2_000, 2_000, 200)
    const anchor = nearestElementCentre(fixture, centreOfBounds(fixture))
    const start = visibleCentre(viewportFor('S2', fixture))
    const travel = 2 * (anchor.x - start.x)
    const room = fixture.bounds.maxX - fixture.bounds.minX - VIEWPORT_WIDTH

    expect(travel).toBeLessThan(6_000)
    expect(travel).toBeCloseTo(room, 6)
  })

  it('puts every element on screen for the all-visible scenarios', () => {
    // Wider than tall, like the real dense grid, so its fit zoom clears the camera's own 0.1
    // floor and the scenario measures a state the product can actually reach.
    const fixture = gridFixture(12_000, 5_000)
    for (const id of ['S4a', 'S4b'] as const) {
      const viewport = viewportFor(id, fixture)
      const rect = visibleRect(viewport)
      for (const el of fixture.elements) {
        expect(el.x).toBeGreaterThanOrEqual(rect.left)
        expect(el.y).toBeGreaterThanOrEqual(rect.top)
        expect(el.x + el.width).toBeLessThanOrEqual(rect.right)
        expect(el.y + el.height).toBeLessThanOrEqual(rect.bottom)
      }
      expect(SCENARIO_PLANS[id].requiredOnScreen(fixture)).toBe(fixture.elements.length)
    }
  })

  it('centres the group drag on the dragged frame and its members, not on the whole fixture', () => {
    const frame = element('f0', 500, 500, 320, 220, {
      kind: 'frame',
      title: 'group',
      childIds: ['m0', 'm1'],
    })
    const fixture = fixtureOf([
      frame,
      element('m0', 400, 400),
      element('m1', 900, 700),
      element('far', 50_000, 50_000),
    ])
    const viewport = viewportFor('S7', fixture, emptyRoles({ groupDragFrameIds: ['f0'] }))

    expect(viewport.zoom).toBeCloseTo(0.5, 6)
    const centre = visibleCentre(viewport)
    expect(centre.x).toBeCloseTo((400 + 1_000) / 2, 6)
    expect(centre.y).toBeCloseTo((400 + 750) / 2, 6)
  })

  it('refuses to plan a group drag when the fixture designates no 120-member frame', () => {
    const fixture = gridFixture(5_000, 5_000)
    expect(() => viewportFor('S7', fixture)).toThrow(/groupDragFrameIds/)
  })
})

// ---- camera proofs -------------------------------------------------------------------------------

describe('applyScenarioViewport', () => {
  it('records both camera proofs, passing when the arm honours the contract', async () => {
    const fixture = gridFixture(20_000, 20_000)
    const arm = createFakeArm(fixture)
    const plan = planFor('S6')
    const ctx = contextFor(plan, fixture, arm)

    await applyScenarioViewport(ctx, plan)

    expect(ctx.ledger.size).toBe(2)
    expect(ctx.ledger.failures()).toHaveLength(0)
  })

  it('fails the on-screen proof when the arm reads the viewport in the wrong convention', async () => {
    // The arm accepts the numbers, reports them back unchanged, and still renders nothing: the
    // applied-viewport proof passes and only the on-screen proof catches it.
    const fixture = gridFixture(20_000, 20_000)
    const arm = createFakeArm(fixture, { misreadViewportConvention: true })
    const plan = planFor('S6')
    const ctx = contextFor(plan, fixture, arm)

    await applyScenarioViewport(ctx, plan)

    const failures = ctx.ledger.failures()
    expect(failures).toHaveLength(1)
    expect(failures[0].gesture).toBe('viewport:onScreen')
    expect(failures[0].stateMatched).toBe(false)
  })

  it('applies the scenario level-of-detail setting to the arm', async () => {
    const fixture = gridFixture(12_000, 5_000)
    const arm = createFakeArm(fixture)
    const plan = planFor('S4b')
    await applyScenarioViewport(contextFor(plan, fixture, arm), plan)
    expect(arm.isLodEnabled()).toBe(false)
  })
})

// ---- helpers ---------------------------------------------------------------------------------------

describe('createOccupancyTest', () => {
  it('reports a point inside an element and a point in the gap between them', () => {
    const fixture = fixtureOf([element('a', 0, 0, 100, 50), element('b', 400, 0, 100, 50)])
    const occupied = createOccupancyTest(fixture)

    expect(occupied({ x: 50, y: 25 })).toBe(true)
    expect(occupied({ x: 450, y: 25 })).toBe(true)
    expect(occupied({ x: 250, y: 25 })).toBe(false)
    expect(occupied({ x: 50, y: 400 })).toBe(false)
  })
})

describe('worstFrameDeltaMs', () => {
  const samples: readonly FrameSample[] = [
    { t: 1, dt: 8, phase: 'warmup' },
    { t: 2, dt: 300, phase: 'warmup' },
    { t: 3, dt: 12, phase: 'driven' },
    { t: 4, dt: 41, phase: 'driven' },
    { t: 5, dt: 900, phase: 'settle' },
  ]

  it('reads only the requested phase, so a warmup stall is never charged to a driven window', () => {
    expect(worstFrameDeltaMs(samples, 'driven')).toBe(41)
    expect(worstFrameDeltaMs(samples, 'warmup')).toBe(300)
    expect(worstFrameDeltaMs(samples, 'settle')).toBe(900)
  })

  it('returns 0 for a phase that recorded nothing', () => {
    expect(worstFrameDeltaMs([], 'driven')).toBe(0)
  })
})
