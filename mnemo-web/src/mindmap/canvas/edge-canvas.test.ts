// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import type { SceneEdge } from '../model/scene'
import {
  createEdgeCanvasRenderer,
  type EdgeCanvasContext,
  type EdgeCanvasSurface,
} from './edge-canvas'
import { anchorsFor, edgeShape, type ElementBox } from './edge-paths'

/**
 * The canvas edge mode has no proof in the harness: no scenario asserts edge geometry, so a
 * canvas that drew stale curves, the wrong colours, or nothing at all would pass every run and
 * post the best frame times in the spike. These tests are the only thing standing between that
 * and a confident wrong answer, so they check what is drawn rather than that drawing happened.
 *
 * jsdom ships no 2D context, hence the recorder below. It is not a limitation worked around: a
 * fake context is how the drawn geometry becomes assertable at all.
 */

interface Entry {
  readonly op: string
  readonly args: readonly (number | string)[]
}

interface Recorder {
  readonly context: EdgeCanvasContext
  readonly entries: Entry[]
}

function recorder(): Recorder {
  const entries: Entry[] = []
  let strokeStyle = ''
  let lineWidth = 0
  const context: EdgeCanvasContext = {
    get strokeStyle(): string {
      return strokeStyle
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      strokeStyle = String(value)
      entries.push({ op: 'strokeStyle', args: [strokeStyle] })
    },
    get lineWidth(): number {
      return lineWidth
    },
    set lineWidth(value: number) {
      lineWidth = value
      entries.push({ op: 'lineWidth', args: [value] })
    },
    setTransform: (a, b, c, d, e, f) => {
      entries.push({ op: 'setTransform', args: [a, b, c, d, e, f] })
    },
    clearRect: (x, y, width, height) => {
      entries.push({ op: 'clearRect', args: [x, y, width, height] })
    },
    setLineDash: (segments) => {
      entries.push({ op: 'setLineDash', args: [...segments] })
    },
    beginPath: () => {
      entries.push({ op: 'beginPath', args: [] })
    },
    moveTo: (x, y) => {
      entries.push({ op: 'moveTo', args: [x, y] })
    },
    lineTo: (x, y) => {
      entries.push({ op: 'lineTo', args: [x, y] })
    },
    bezierCurveTo: (c1x, c1y, c2x, c2y, x, y) => {
      entries.push({ op: 'bezierCurveTo', args: [c1x, c1y, c2x, c2y, x, y] })
    },
    stroke: () => {
      entries.push({ op: 'stroke', args: [] })
    },
  }
  return { context, entries }
}

const SOURCE: ElementBox = { x: 0, y: 0, width: 100, height: 40 }
const TARGET: ElementBox = { x: 300, y: 100, width: 100, height: 40 }
const FAR_SOURCE: ElementBox = { x: 1000, y: 1000, width: 100, height: 40 }

const BOXES: Record<string, ElementBox> = { s: SOURCE, t: TARGET, far: FAR_SOURCE }

function boxOf(id: string): ElementBox | undefined {
  return BOXES[id]
}

function edge(id: string, extra: Partial<SceneEdge> = {}): SceneEdge {
  return { id, fromId: 's', toId: 't', kind: 'link', ...extra }
}

interface Harness {
  readonly entries: Entry[]
  readonly canvas: EdgeCanvasSurface
  draw(ids: readonly string[], viewport?: { x: number; y: number; zoom: number }): void
}

function mount(edges: readonly SceneEdge[], dpr = 1): Harness {
  const { context, entries } = recorder()
  const canvas: EdgeCanvasSurface = { width: 0, height: 0 }
  const renderer = createEdgeCanvasRenderer({ canvas, context, edges, boxOf })
  renderer.resize(800, 600, dpr)
  entries.length = 0
  return {
    entries,
    canvas,
    draw: (ids, viewport = { x: 0, y: 0, zoom: 1 }) => renderer.draw(viewport, ids),
  }
}

/**
 * A renderer over one straight edge whose source can be moved, with a count of how many times the
 * endpoint boxes were actually read. The read count is the cache's observable behaviour: a cached
 * frame reads nothing.
 */
function movable() {
  const boxes: Record<string, ElementBox> = { s: SOURCE, t: TARGET }
  let reads = 0
  const { context, entries } = recorder()
  const renderer = createEdgeCanvasRenderer({
    canvas: { width: 0, height: 0 },
    context,
    edges: [edge('e1', { routing: 'straight' })],
    boxOf: (id) => {
      reads += 1
      return boxes[id]
    },
  })
  renderer.resize(800, 600, 1)
  entries.length = 0
  return {
    entries,
    renderer,
    reads: () => reads,
    moveSource: (x: number, y: number) => {
      boxes.s = { ...SOURCE, x, y }
    },
    draw: (viewport = { x: 0, y: 0, zoom: 1 }) => renderer.draw(viewport, ['e1']),
  }
}

function ops(entries: readonly Entry[], op: string): readonly Entry[] {
  return entries.filter((entry) => entry.op === op)
}

function argsOf(entries: readonly Entry[], op: string): readonly (readonly (number | string)[])[] {
  return ops(entries, op).map((entry) => entry.args)
}

describe('createEdgeCanvasRenderer geometry', () => {
  it('draws the same cubic the svg mode draws', () => {
    // Derived from edge-paths rather than restated, so the two modes cannot drift apart without
    // this failing. An arm that draws a different curve than the arm it is compared against is
    // not faster, it is drawing less.
    const stroke = edgeShape('curve', anchorsFor(SOURCE, TARGET)).stroke
    if (stroke.kind !== 'cubic') throw new Error('the default routing must be a cubic')

    const harness = mount([edge('e1')])
    harness.draw(['e1'])

    expect(argsOf(harness.entries, 'moveTo')).toEqual([[stroke.sx, stroke.sy]])
    expect(argsOf(harness.entries, 'bezierCurveTo')).toEqual([
      [stroke.c1x, stroke.c1y, stroke.c2x, stroke.c2y, stroke.tx, stroke.ty],
    ])
  })

  it('draws a straight routing as one line', () => {
    const harness = mount([edge('e1', { routing: 'straight' })])
    harness.draw(['e1'])

    expect(argsOf(harness.entries, 'moveTo')).toEqual([[100, 20]])
    expect(argsOf(harness.entries, 'lineTo')).toEqual([[300, 120]])
    expect(ops(harness.entries, 'bezierCurveTo')).toHaveLength(0)
  })

  it('draws an orthogonal routing as three axis-aligned segments', () => {
    const harness = mount([edge('e1', { routing: 'orthogonal' })])
    harness.draw(['e1'])

    expect(argsOf(harness.entries, 'moveTo')).toEqual([[100, 20]])
    expect(argsOf(harness.entries, 'lineTo')).toEqual([
      [200, 20],
      [200, 120],
      [300, 120],
    ])
  })

  it('reads live boxes rather than the coordinates the fixture was built with', () => {
    // The whole reason boxOf is a callback: a drag rewrites positions in the scene index and the
    // canvas has to read them.
    const { entries, moveSource, draw } = movable()
    moveSource(50, 25)
    draw()
    expect(argsOf(entries, 'moveTo')).toEqual([[150, 45]])
  })
})

/**
 * Geometry is cached per edge and only recomputed when the caller says an endpoint moved.
 *
 * This is not a micro-optimization, it is the fix for a measured regression. Rebuilding every
 * visible curve on every frame made canvas mode beat SVG where almost nothing was on screen and
 * lose badly where a lot was, which is the signature of per-frame work proportional to visible
 * edges. A pan moves the camera, not the elements, so that work was pure waste.
 *
 * The cost of caching is that staleness is now possible, and these tests are what make the
 * invalidation contract explicit rather than assumed.
 */
describe('createEdgeCanvasRenderer geometry cache', () => {
  it('does not re-read endpoint boxes on a redraw, which is what makes a pan cheap', () => {
    const { reads, draw } = movable()
    draw()
    const afterFirst = reads()
    for (let i = 0; i < 10; i++) draw({ x: i * 10, y: 0, zoom: 1 })
    expect(reads()).toBe(afterFirst)
  })

  it('keeps drawing the old curve until the mover is invalidated', () => {
    // Stated as a test rather than left implicit: this IS the contract, and an endpoint that
    // moved without an invalidate would otherwise be a silent visual bug.
    const { entries, moveSource, draw } = movable()
    draw()
    moveSource(50, 25)
    entries.length = 0
    draw()
    expect(argsOf(entries, 'moveTo')).toEqual([[100, 20]])
  })

  it('picks up the new position once that edge is invalidated', () => {
    const { entries, moveSource, draw, renderer } = movable()
    draw()
    moveSource(50, 25)
    renderer.invalidate(['e1'])
    entries.length = 0
    draw()
    expect(argsOf(entries, 'moveTo')).toEqual([[150, 45]])
  })

  it('invalidates only the edges named, leaving the rest cached', () => {
    const { reads, renderer, draw } = movable()
    draw()
    const afterFirst = reads()
    renderer.invalidate(['not-this-one'])
    draw()
    expect(reads()).toBe(afterFirst)
  })

  it('drops everything on invalidateAll, for a relayout that moved the whole document', () => {
    const { entries, moveSource, draw, renderer } = movable()
    draw()
    moveSource(50, 25)
    renderer.invalidateAll()
    entries.length = 0
    draw()
    expect(argsOf(entries, 'moveTo')).toEqual([[150, 45]])
  })
})

describe('createEdgeCanvasRenderer strokes', () => {
  it('strokes a hierarchy edge in the hierarchy colour and width, undashed', () => {
    const harness = mount([edge('e1', { kind: 'hierarchy' })])
    harness.draw(['e1'])

    expect(argsOf(harness.entries, 'strokeStyle')).toEqual([['#4a5162']])
    expect(argsOf(harness.entries, 'lineWidth')).toEqual([[1.25]])
    expect(argsOf(harness.entries, 'setLineDash')).toEqual([[]])
  })

  it('falls back to the link colour and width when the edge names neither', () => {
    const harness = mount([edge('e1')])
    harness.draw(['e1'])

    expect(argsOf(harness.entries, 'strokeStyle')).toEqual([['#7b869c']])
    expect(argsOf(harness.entries, 'lineWidth')).toEqual([[1.5]])
  })

  it("honours a link edge's own colour and thickness", () => {
    const harness = mount([edge('e1', { color: '#ff0044', thickness: 3 })])
    harness.draw(['e1'])

    expect(argsOf(harness.entries, 'strokeStyle')).toEqual([['#ff0044']])
    expect(argsOf(harness.entries, 'lineWidth')).toEqual([[3]])
  })

  it('dashes and dots to the same pattern the svg mode uses', () => {
    const dashed = mount([edge('e1', { lineStyle: 'dashed' })])
    dashed.draw(['e1'])
    expect(argsOf(dashed.entries, 'setLineDash')).toEqual([[6, 4]])

    const dotted = mount([edge('e1', { lineStyle: 'dotted' })])
    dotted.draw(['e1'])
    expect(argsOf(dotted.entries, 'setLineDash')).toEqual([[1, 4]])
  })

  it('leaves solid and double undashed, which is the choice the svg mode makes', () => {
    for (const lineStyle of ['solid', 'double'] as const) {
      const harness = mount([edge('e1', { lineStyle })])
      harness.draw(['e1'])
      expect(argsOf(harness.entries, 'setLineDash')).toEqual([[]])
    }
  })

  it('batches edges that share a style into one stroke and splits when it changes', () => {
    // Hierarchy edges are the bulk of the document and all share one style, so collapsing them
    // into a single path is most of what makes a redraw cheap. It must not collapse edges that
    // look different, which would silently repaint half the document in the wrong colour.
    const same = mount([edge('a', { kind: 'hierarchy' }), edge('b', { kind: 'hierarchy' })])
    same.draw(['a', 'b'])
    expect(ops(same.entries, 'beginPath')).toHaveLength(1)
    expect(ops(same.entries, 'stroke')).toHaveLength(1)
    expect(ops(same.entries, 'moveTo')).toHaveLength(2)

    const mixed = mount([edge('a', { kind: 'hierarchy' }), edge('b', { lineStyle: 'dashed' })])
    mixed.draw(['a', 'b'])
    expect(ops(mixed.entries, 'stroke')).toHaveLength(2)
    expect(argsOf(mixed.entries, 'strokeStyle')).toEqual([['#4a5162'], ['#7b869c']])
  })
})

describe('createEdgeCanvasRenderer camera and backing store', () => {
  it('scales the backing store by the device pixel ratio', () => {
    const harness = mount([edge('e1')], 2)
    expect(harness.canvas.width).toBe(1600)
    expect(harness.canvas.height).toBe(1200)
  })

  it('folds the ratio into the camera, so a canvas unit is one css pixel at zoom 1', () => {
    const harness = mount([edge('e1')], 2)
    harness.draw(['e1'], { x: 10, y: 20, zoom: 0.5 })

    // Reset to device space to clear, then the camera: scale is zoom * dpr, and the translation
    // is the camera origin in the same units, which is what the svg group's transform does.
    expect(argsOf(harness.entries, 'setTransform')).toEqual([
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 1, -10, -20],
    ])
    expect(argsOf(harness.entries, 'clearRect')).toEqual([[0, 0, 1600, 1200]])
  })

  it('does not reset the backing store when nothing about the surface changed', () => {
    // Assigning width or height clears the canvas and reallocates it. Resize is called from the
    // same place the camera is committed, so an unguarded one would do that on every frame of a
    // pan and hand the mode a cost it does not really have.
    const { context } = recorder()
    const canvas: EdgeCanvasSurface = { width: 0, height: 0 }
    const renderer = createEdgeCanvasRenderer({ canvas, context, edges: [edge('e1')], boxOf })

    renderer.resize(800, 600, 2)
    canvas.width = 7
    renderer.resize(800, 600, 2)
    expect(canvas.width).toBe(7)

    renderer.resize(801, 600, 2)
    expect(canvas.width).toBe(1602)
  })
})

describe('createEdgeCanvasRenderer draw list', () => {
  it('touches only the edges it was given', () => {
    // The entire claim of the arm: per-frame work is proportional to what is in view, never to
    // the four and a half thousand edges the document holds.
    const harness = mount([
      edge('a', { routing: 'straight' }),
      edge('b', { routing: 'straight', fromId: 'far' }),
      edge('c', { routing: 'straight' }),
    ])
    harness.draw(['b'])

    expect(argsOf(harness.entries, 'moveTo')).toEqual([[1100, 1020]])
  })

  it('skips an id it does not know and an edge whose endpoint has no box', () => {
    const harness = mount([edge('a', { routing: 'straight', toId: 'ghost' })])
    harness.draw(['a', 'nonexistent'])

    expect(ops(harness.entries, 'moveTo')).toHaveLength(0)
    expect(ops(harness.entries, 'stroke')).toHaveLength(0)
    // The clear still happens, so a frame that draws nothing leaves nothing behind.
    expect(ops(harness.entries, 'clearRect')).toHaveLength(1)
  })
})
