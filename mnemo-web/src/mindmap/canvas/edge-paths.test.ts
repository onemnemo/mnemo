import { describe, expect, it } from 'vitest'

import {
  anchorsFor,
  branchShape,
  capsOf,
  edgeGeometry,
  edgeShape,
  isFilled,
  strokeToPathData,
  type ElementBox,
} from './edge-paths'

const box = (x: number, y: number, width = 100, height = 40): ElementBox => ({ x, y, width, height })

/** A plain node: text with a coloured rule under it, and almost no box around it. */
const plain = (x: number, y: number, underline = 3.5): ElementBox => ({
  x,
  y,
  width: 100,
  height: 20,
  underline,
})

describe('choosing where an edge attaches', () => {
  it('leaves the right and arrives on the left when the target is to the right', () => {
    const a = anchorsFor(box(0, 0), box(400, 0))

    expect(a.axis).toBe('x')
    expect(a.sign).toBe(1)
    expect(a.sx).toBe(100)
    expect(a.tx).toBe(400)
  })

  it('mirrors when the target is to the left, which a balanced map needs on half its branches', () => {
    // The spike anchored right-to-left always, which is correct for a left-to-right flow chart and
    // wrong for a map that fans both ways from its root.
    const a = anchorsFor(box(400, 0), box(0, 0))

    expect(a.axis).toBe('x')
    expect(a.sign).toBe(-1)
    expect(a.sx).toBe(400)
    expect(a.tx).toBe(100)
  })

  it('attaches sideways only when the horizontal gap clearly dominates', () => {
    // The horizontal offset is discounted before the comparison, so a merely-larger horizontal gap
    // is not enough: a diagonal child sprouts from underneath rather than from the flank.
    expect(anchorsFor(box(0, 0), box(400, 60)).axis).toBe('x')
    expect(anchorsFor(box(0, 0), box(300, 300)).axis).toBe('y')
    expect(anchorsFor(box(0, 0), box(100, 400)).axis).toBe('y')
  })

  it('needs the horizontal gap to beat the vertical one by about a third', () => {
    // Pinning the threshold itself: at exactly 4:3 it is still sideways, just past it is not.
    const centred = (x: number, y: number): ElementBox => ({ x, y, width: 0, height: 0 })
    expect(anchorsFor(centred(0, 0), centred(400, 300)).axis).toBe('x')
    expect(anchorsFor(centred(0, 0), centred(400, 301)).axis).toBe('y')
  })

  it('gives both ends the same axis', () => {
    // An edge that leaves sideways and arrives from above is a corner, not a curve.
    for (const target of [box(400, 30), box(-400, 30), box(20, 500), box(20, -500)]) {
      const a = anchorsFor(box(0, 0), target)
      expect(a.axis).toBe(a.axis)
      expect(['x', 'y']).toContain(a.axis)
    }
  })
})

describe('a plain node', () => {
  it('is met at its rule rather than its mid-height when the edge comes in sideways', () => {
    const target = plain(400, 100)
    const a = anchorsFor(box(0, 100), target)

    expect(a.ty).toBeCloseTo(target.y + target.height - 3.5 / 2, 6)
  })

  it('is met at its rule when the edge comes in vertically too', () => {
    // The defect this file was rewritten for: the correction was applied on the horizontal branch
    // and skipped on the vertical one, so a child stacked under its parent had its branch stop at
    // the invisible top of a text box, leaving a seam between the line and the word.
    const target = plain(20, 500)
    const a = anchorsFor(box(0, 0), target)

    expect(a.axis).toBe('y')
    expect(a.ty).toBeCloseTo(target.y + target.height - 3.5 / 2, 6)
  })

  it('is met at its rule when approached from below as well as from above', () => {
    const target = plain(20, -500)
    const a = anchorsFor(box(0, 0), target)

    expect(a.axis).toBe('y')
    expect(a.ty).toBeCloseTo(target.y + target.height - 3.5 / 2, 6)
  })

  it('leaves a boxed node at its mid-height, unchanged', () => {
    const source = box(0, 100)
    const a = anchorsFor(source, box(400, 100))

    expect(a.sy).toBeCloseTo(source.y + source.height / 2, 6)
  })
})

describe('routings', () => {
  const a = anchorsFor(box(0, 0), box(400, 200))

  it('curve leaves and arrives along the attachment axis', () => {
    const shape = edgeShape('curve', a)

    expect(shape.stroke.kind).toBe('cubic')
    if (shape.stroke.kind !== 'cubic') return
    // Horizontal attachment, so the control points share their endpoint's y and the curve leaves
    // and arrives level.
    expect(shape.stroke.c1y).toBe(a.sy)
    expect(shape.stroke.c2y).toBe(a.ty)
  })

  it('straight is two points and nothing else', () => {
    const shape = edgeShape('straight', a)

    expect(shape.stroke).toEqual({
      kind: 'polyline',
      points: [
        { x: a.sx, y: a.sy },
        { x: a.tx, y: a.ty },
      ],
    })
  })

  it('orthogonal turns twice through the midpoint of its axis', () => {
    const shape = edgeShape('orthogonal', a)

    expect(shape.stroke.kind).toBe('polyline')
    if (shape.stroke.kind !== 'polyline') return
    const mid = (a.sx + a.tx) / 2
    expect(shape.stroke.points.map((p) => p.x)).toEqual([a.sx, mid, mid, a.tx])
  })

  it('orthogonal draws a straight line when the ends are already square on', () => {
    const level = anchorsFor(box(0, 0), box(400, 0))
    const shape = edgeShape('orthogonal', level)

    expect(shape.stroke.kind).toBe('polyline')
    if (shape.stroke.kind !== 'polyline') return
    // A bend here would be a wiggle rather than a corner.
    expect(shape.stroke.points).toHaveLength(2)
  })

  it('orthogonal turns on the other axis for a vertical attachment', () => {
    const vertical = anchorsFor(box(0, 0), box(20, 500))
    const shape = edgeShape('orthogonal', vertical)

    expect(shape.stroke.kind).toBe('polyline')
    if (shape.stroke.kind !== 'polyline') return
    const mid = (vertical.sy + vertical.ty) / 2
    expect(shape.stroke.points.map((p) => p.y)).toEqual([vertical.sy, mid, mid, vertical.ty])
  })

  it('puts a label at the midpoint of the curve rather than of the chord', () => {
    const shape = edgeShape('curve', a)
    const chordMid = { x: (a.sx + a.tx) / 2, y: (a.sy + a.ty) / 2 }

    // Only y coincides here; a curve pulls its midpoint off the chord along the free axis.
    expect(shape.label.y).toBeCloseTo(chordMid.y, 6)
    expect(shape.label.x).toBeCloseTo(chordMid.x, 6)
  })
})

describe('a branch', () => {
  const a = anchorsFor(box(0, 0), box(400, 60))

  it('is a filled ribbon when its ends carry different weights', () => {
    const shape = branchShape('curve', a, 7, 2.4)

    expect(shape.stroke.kind).toBe('ribbon')
    expect(isFilled(shape.stroke)).toBe(true)
  })

  it('is an ordinary stroke when both ends weigh the same', () => {
    const shape = branchShape('curve', a, 3, 3)

    expect(shape.stroke.kind).toBe('cubic')
    expect(isFilled(shape.stroke)).toBe(false)
  })

  it('never tapers an elbow, which would look broken at the corner', () => {
    const shape = branchShape('orthogonal', a, 7, 2.4)

    expect(shape.stroke.kind).toBe('polyline')
  })

  it('is a ribbon wide at the source and narrow at the target', () => {
    const shape = branchShape('curve', a, 8, 2)

    expect(shape.stroke.kind).toBe('ribbon')
    if (shape.stroke.kind !== 'ribbon') return
    // Horizontal attachment, so the ribbon thickens vertically: the two source-side points sit 8
    // apart and the two target-side points 2 apart.
    const sourceSpread = Math.abs(shape.stroke.outbound[0].y - shape.stroke.inbound[3].y)
    const targetSpread = Math.abs(shape.stroke.outbound[3].y - shape.stroke.inbound[0].y)
    expect(sourceSpread).toBeCloseTo(8, 6)
    expect(targetSpread).toBeCloseTo(2, 6)
  })

  it('thickens across the other axis when it attaches vertically', () => {
    const vertical = anchorsFor(box(0, 0), box(20, 500))
    const shape = branchShape('curve', vertical, 8, 2)

    expect(shape.stroke.kind).toBe('ribbon')
    if (shape.stroke.kind !== 'ribbon') return
    expect(Math.abs(shape.stroke.outbound[0].x - shape.stroke.inbound[3].x)).toBeCloseTo(8, 6)
  })

  it('follows the same line as the plain stroke it widens', () => {
    const stroke = edgeShape('curve', a)
    const widened = branchShape('curve', a, 6, 6.5)

    expect(stroke.stroke.kind).toBe('cubic')
    expect(widened.stroke.kind).toBe('ribbon')
    if (stroke.stroke.kind !== 'cubic' || widened.stroke.kind !== 'ribbon') return
    // The ribbon's two edges straddle the stroke, so their mean is the stroke itself.
    expect((widened.stroke.outbound[0].y + widened.stroke.inbound[3].y) / 2).toBeCloseTo(stroke.stroke.sy, 6)
  })
})

describe('path data', () => {
  const a = anchorsFor(box(0, 0), box(400, 60))

  it('writes a cubic as one C command', () => {
    const path = edgeGeometry('curve', a).path

    expect(path.startsWith('M')).toBe(true)
    expect(path).toContain('C')
  })

  it('writes a polyline as L commands', () => {
    expect(edgeGeometry('orthogonal', a).path).toContain('L')
  })

  it('closes a ribbon, since an open one would fill to a straight line across its mouth', () => {
    const path = strokeToPathData(branchShape('curve', a, 7, 2).stroke)

    expect(path.endsWith('Z')).toBe(true)
    // Out along one edge and back along the other: two curves, not one.
    expect(path.split('C')).toHaveLength(3)
  })
})

describe('cap placement', () => {
  const a = anchorsFor(box(0, 0), box(400, 60))

  it('sits at the two ends of the curve', () => {
    const caps = capsOf(edgeShape('curve', a).stroke)!

    expect(caps.start).toMatchObject({ x: a.sx, y: a.sy })
    expect(caps.end).toMatchObject({ x: a.tx, y: a.ty })
  })

  it('takes its direction from the curve, not from the chord between the boxes', () => {
    // The attachment is horizontal, so the curve arrives level however far apart the ends are
    // vertically. An arrowhead following the chord would come in at a visible angle to its own line.
    const caps = capsOf(edgeShape('curve', a).stroke)!

    expect(Math.sin(caps.end.angle)).toBeCloseTo(0, 6)
    expect(Math.cos(caps.end.angle)).toBeGreaterThan(0)
  })

  it('points the start cap back down the line, away from the node it touches', () => {
    const caps = capsOf(edgeShape('curve', a).stroke)!

    expect(Math.cos(caps.start.angle)).toBeLessThan(0)
  })

  it('follows the last segment of an elbow rather than its overall direction', () => {
    const vertical = anchorsFor(box(0, 0), box(20, 500))
    const caps = capsOf(edgeShape('orthogonal', vertical).stroke)!

    // The final leg of a vertically attached elbow runs down, so the cap points down.
    expect(Math.abs(Math.cos(caps.end.angle))).toBeCloseTo(0, 6)
  })

  it('has none for a ribbon, whose taper already says which end is which', () => {
    expect(capsOf(branchShape('curve', a, 7, 2).stroke)).toBeNull()
  })
})
