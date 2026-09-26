import { describe, expect, it } from 'vitest'

import type { Point, SceneEdge } from '../model/scene'
import { capInset } from '../scene/cap-geometry'
import { drawingFor as drawingBetween, drawingPathData, strokeFor } from './edge-drawing'
import { anchorsFor, type EdgeStroke, type ElementBox } from './edge-paths'

const SOURCE: ElementBox = { x: 0, y: 0, width: 100, height: 40 }
const TARGET: ElementBox = { x: 300, y: 100, width: 100, height: 40 }
const anchors = anchorsFor(SOURCE, TARGET)
const drawingFor = (input: SceneEdge, at = anchors) => drawingBetween(input, at)
const tip = { x: anchors.tx, y: anchors.ty }
const tail = { x: anchors.sx, y: anchors.sy }

function edge(extra: Partial<SceneEdge> = {}): SceneEdge {
  return { id: 'e', fromId: 's', toId: 't', kind: 'link', thickness: 4, ...extra }
}

function endsOf(stroke: EdgeStroke | null): { start: Point; end: Point } {
  if (!stroke) throw new Error('no stroke')
  if (stroke.kind === 'cubic') return { start: { x: stroke.sx, y: stroke.sy }, end: { x: stroke.tx, y: stroke.ty } }
  if (stroke.kind === 'polyline') return { start: stroke.points[0], end: stroke.points[stroke.points.length - 1] }
  throw new Error(`no single line in a ${stroke.kind}`)
}

const gap = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

describe('drawingFor', () => {
  for (const routing of ['curve', 'straight', 'orthogonal'] as const) {
    it(`stops a ${routing} line under its arrowhead and puts the tip where the line used to end`, () => {
      const drawing = drawingFor(edge({ routing, endCap: 'arrow', lineStyle: 'dashed' }))
      const { start, end } = endsOf(drawing.stroke)

      expect(drawing.caps).toEqual([expect.objectContaining({ kind: 'arrow', x: tip.x, y: tip.y })])
      expect(gap(end, tip)).toBeCloseTo(capInset('arrow', 4), 6)
      expect(gap(start, tail)).toBe(0)
    })
  }

  it('trims both ends when both are arrows', () => {
    const { start, end } = endsOf(drawingFor(edge({ startCap: 'arrow', endCap: 'arrow' })).stroke)

    expect(gap(start, tail)).toBeCloseTo(capInset('arrow', 4), 6)
    expect(gap(end, tip)).toBeCloseTo(capInset('arrow', 4), 6)
  })

  it('leaves a dotted end running to its dot', () => {
    const drawing = drawingFor(edge({ endCap: 'dot', lineStyle: 'dotted' }))

    expect(gap(endsOf(drawing.stroke).end, tip)).toBe(0)
    expect(drawing.caps).toEqual([expect.objectContaining({ kind: 'dot', x: tip.x, y: tip.y })])
  })

  it('stops both rails of a double line at the same base, beside the tip', () => {
    const drawing = drawingFor(edge({ endCap: 'arrow', lineStyle: 'double' }))
    if (drawing.stroke?.kind !== 'rails') throw new Error('expected rails')

    const [one, other] = drawing.stroke.rails.map((rail) => rail[rail.length - 1])
    const centre = { x: (one.x + other.x) / 2, y: (one.y + other.y) / 2 }
    expect(gap(centre, tip)).toBeCloseTo(capInset('arrow', 4), 6)
    expect(gap(one, other)).toBeCloseTo(8, 6)
    expect(drawing.caps[0]).toMatchObject({ x: tip.x, y: tip.y })
  })

  it('never caps or trims a ribbon', () => {
    const ribbon = edge({ kind: 'hierarchy', endCap: 'arrow', fromWidth: 7, toWidth: 2 })
    const drawing = drawingFor(ribbon)

    expect(drawing.caps).toHaveLength(0)
    expect(drawing.stroke).toEqual(strokeFor(ribbon, anchors))
  })

  it('draws an uncapped edge exactly as before', () => {
    const plain = edge({ lineStyle: 'dashed' })
    expect(drawingFor(plain).stroke).toEqual(strokeFor(plain, anchors))
  })

  it('draws a line shorter than its two heads as the heads alone, with no stroke to leave a dot', () => {
    const near = anchorsFor({ x: 0, y: 0, width: 10, height: 10 }, { x: 14, y: 0, width: 10, height: 10 })
    for (const routing of ['straight', 'curve'] as const) {
      const drawing = drawingFor(edge({ routing, startCap: 'arrow', endCap: 'arrow', thickness: 6 }), near)

      expect(drawing.stroke).toBeNull()
      expect(drawing.caps).toHaveLength(2)
      expect(drawingPathData(drawing.stroke)).toBe('')
    }
  })

  it('stops a double elbow at the corner when its last leg is shorter than the head, with the rails level', () => {
    const near = anchorsFor(SOURCE, { x: 130, y: 60, width: 100, height: 40 })
    const drawing = drawingFor(edge({ routing: 'orthogonal', endCap: 'arrow', lineStyle: 'double' }), near)
    if (drawing.stroke?.kind !== 'rails') throw new Error('expected rails')

    const corner = { x: (near.sx + near.tx) / 2, y: near.ty }
    for (const rail of drawing.stroke.rails) {
      expect(gap(rail[rail.length - 1], rail[rail.length - 2])).toBeGreaterThan(1)
    }
    const [one, other] = drawing.stroke.rails.map((rail) => rail[rail.length - 1])
    expect(one.y).toBeCloseTo(corner.y, 6)
    expect(other.y).toBeCloseTo(corner.y, 6)
    expect((one.x + other.x) / 2).toBeCloseTo(corner.x, 6)
  })

  it('points the end cap along the curve at the tip and the start cap back along it', () => {
    const base = strokeFor(edge(), anchors)
    if (base.kind !== 'cubic') throw new Error('expected a cubic')
    const [start, end] = drawingFor(edge({ startCap: 'arrow', endCap: 'arrow' })).caps

    expect(end.angle).toBeCloseTo(Math.atan2(base.ty - base.c2y, base.tx - base.c2x), 9)
    expect(start.angle).toBeCloseTo(Math.atan2(base.sy - base.c1y, base.sx - base.c1x), 9)
    expect(Math.cos(start.angle)).toBeLessThan(0)
    expect(Math.cos(end.angle)).toBeGreaterThan(0)
  })

  it('ends a curve on its arrowheads axes, arriving along them, so each head sits straight and centred', () => {
    const drawing = drawingFor(edge({ startCap: 'arrow', endCap: 'arrow' }))
    if (drawing.stroke?.kind !== 'cubic') throw new Error('expected a cubic')
    const curve = drawing.stroke
    const [start, end] = drawing.caps
    const offAxis = (cap: { x: number; y: number; angle: number }, p: Point) =>
      Math.abs(Math.sin(cap.angle) * (p.x - cap.x) - Math.cos(cap.angle) * (p.y - cap.y))

    expect(offAxis(end, { x: curve.tx, y: curve.ty })).toBeCloseTo(0, 9)
    expect(offAxis(start, { x: curve.sx, y: curve.sy })).toBeCloseTo(0, 9)
    expect(Math.atan2(curve.ty - curve.c2y, curve.tx - curve.c2x)).toBeCloseTo(end.angle, 9)
    expect(Math.atan2(curve.sy - curve.c1y, curve.sx - curve.c1x)).toBeCloseTo(start.angle, 9)
  })
})
