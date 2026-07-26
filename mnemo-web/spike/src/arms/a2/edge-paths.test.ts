import { describe, expect, it } from 'vitest'

import { anchorsFor, edgeGeometry, type ElementBox } from './edge-paths'

const SOURCE: ElementBox = { x: 0, y: 0, width: 100, height: 40 }
const TARGET: ElementBox = { x: 300, y: 100, width: 100, height: 40 }

describe('anchorsFor', () => {
  it('leaves the source at its right edge and arrives at the target\'s left edge', () => {
    // Matches the handle positions a1 gives React Flow, so the two arms draw the same curve
    // between the same points rather than one of them taking a shorter route.
    expect(anchorsFor(SOURCE, TARGET)).toEqual({ sx: 100, sy: 20, tx: 300, ty: 120 })
  })
})

describe('edgeGeometry', () => {
  it('draws a cubic with horizontal control points for the default curve', () => {
    const { path } = edgeGeometry('curve', anchorsFor(SOURCE, TARGET))
    // Control points share the endpoints' y, which is what makes the curve leave and arrive
    // horizontally, and the offset is half the horizontal gap.
    expect(path).toBe('M100,20 C200,20 200,120 300,120')
  })

  it('does not balloon when the edge doubles back', () => {
    // A negative gap with a linear offset produces a control point further away the more the
    // edge reverses, which draws an enormous loop. React Flow's square-root falloff is what
    // keeps a backwards edge compact, so it has to be reproduced rather than approximated.
    const backwards = edgeGeometry('curve', { sx: 400, sy: 0, tx: 0, ty: 0 })
    const controls = [...backwards.path.matchAll(/C([\d.-]+),/g)].map((m) => Number(m[1]))
    expect(controls[0]).toBeLessThan(400 + 400)
  })

  it('puts a curve label at the cubic\'s midpoint', () => {
    const { label } = edgeGeometry('curve', anchorsFor(SOURCE, TARGET))
    expect(label).toEqual({ x: 200, y: 70 })
  })

  it('draws a straight routing as a single line', () => {
    expect(edgeGeometry('straight', anchorsFor(SOURCE, TARGET)).path).toBe('M100,20 L300,120')
  })

  it('draws an orthogonal routing as three axis-aligned segments', () => {
    expect(edgeGeometry('orthogonal', anchorsFor(SOURCE, TARGET)).path).toBe(
      'M100,20 L200,20 L200,120 L300,120',
    )
  })

  it('follows an element that has moved', () => {
    const moved: ElementBox = { ...SOURCE, x: SOURCE.x + 50, y: SOURCE.y + 25 }
    expect(anchorsFor(moved, TARGET)).toEqual({ sx: 150, sy: 45, tx: 300, ty: 120 })
  })
})
