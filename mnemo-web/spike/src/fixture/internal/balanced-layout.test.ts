import { describe, expect, it } from 'vitest'

import { balancedLayout, boundsOfPositions, layered, translateAll, type SizedNode } from './balanced-layout'

const LEAF: SizedNode = { width: 10, height: 10 }

describe('layered', () => {
  it('matches hand-computed geometry for a two-generation tree', () => {
    // root -> [a, b], both leaves, nodeSpacing 2, rankSpacing 5, horizontal (root-left).
    const childrenOf = new Map([['root', ['a', 'b']]])
    const sizeOf = new Map([
      ['root', LEAF],
      ['a', LEAF],
      ['b', LEAF],
    ])
    const positions = layered('root', childrenOf, sizeOf, true, 2, 5)

    // Depth band 0 (root) centers at width/2 = 5; band 1 starts after 10 + rankSpacing(5) = 15,
    // centers at 15 + 5 = 20.
    // Cross packing: a gets cursor 0 -> center 5; b follows at 10+2=12 -> center 17;
    // root centers on (5+17)/2 = 11.
    expect(positions.get('root')).toEqual({ x: 0, y: 6 }) // x = 5 - 5, y = 11 - 5
    expect(positions.get('a')).toEqual({ x: 15, y: 0 }) // x = 20 - 5, y = 5 - 5
    expect(positions.get('b')).toEqual({ x: 15, y: 12 }) // x = 20 - 5, y = 17 - 5
  })

  it('is deterministic for the same input', () => {
    const childrenOf = new Map([
      ['root', ['a', 'b']],
      ['a', ['c', 'd']],
    ])
    const sizeOf = new Map([
      ['root', LEAF],
      ['a', LEAF],
      ['b', LEAF],
      ['c', LEAF],
      ['d', LEAF],
    ])
    const p1 = layered('root', childrenOf, sizeOf, true, 2, 5)
    const p2 = layered('root', childrenOf, sizeOf, true, 2, 5)
    expect([...p1]).toEqual([...p2])
  })

  it('throws rather than silently placing an unsized node', () => {
    const childrenOf = new Map([['root', ['a']]])
    const sizeOf = new Map([['root', LEAF]])
    expect(() => layered('root', childrenOf, sizeOf, true, 2, 5)).toThrow(/no size registered/)
  })
})

describe('translateAll', () => {
  it('shifts every position by the delta', () => {
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 5, y: 5 }],
    ])
    translateAll(positions, 10, -3)
    expect(positions.get('a')).toEqual({ x: 10, y: -3 })
    expect(positions.get('b')).toEqual({ x: 15, y: 2 })
  })

  it('is a no-op for a zero delta', () => {
    const positions = new Map([['a', { x: 1, y: 2 }]])
    translateAll(positions, 0, 0)
    expect(positions.get('a')).toEqual({ x: 1, y: 2 })
  })
})

describe('balancedLayout', () => {
  it('splits root children alternately right/left and mirrors the left side across the axis', () => {
    // root -> [c1, c2, c3, c4], all leaves. Alternation sends c1,c3 right and c2,c4 left.
    const childrenOf = new Map([['root', ['c1', 'c2', 'c3', 'c4']]])
    const sizeOf = new Map([
      ['root', LEAF],
      ['c1', LEAF],
      ['c2', LEAF],
      ['c3', LEAF],
      ['c4', LEAF],
    ])
    const positions = balancedLayout('root', childrenOf, sizeOf, 2, 5)

    // Hand-derived: right side reproduces the two-child `layered` case above (root at (0,6),
    // c1 at (15,0), c3 at (15,12)); the left side is structurally identical before mirroring,
    // so c2/c4 mirror c1/c3 across axis = rRoot.x + width/2 = 5.
    expect(positions.get('root')).toEqual({ x: 0, y: 6 })
    expect(positions.get('c1')).toEqual({ x: 15, y: 0 })
    expect(positions.get('c3')).toEqual({ x: 15, y: 12 })
    expect(positions.get('c2')).toEqual({ x: -15, y: 0 })
    expect(positions.get('c4')).toEqual({ x: -15, y: 12 })
  })

  it('places a childless root at the origin', () => {
    const childrenOf = new Map<string, readonly string[]>()
    const sizeOf = new Map([['root', LEAF]])
    const positions = balancedLayout('root', childrenOf, sizeOf, 2, 5)
    expect(positions.get('root')).toEqual({ x: 0, y: 0 })
  })

  it('never lets right- and left-side subtrees overlap in X for a wider tree', () => {
    // A bushier tree (3 children per side) still must keep the two sides cleanly separated
    // by the mirror axis, since that is the whole visual point of a balanced mindmap.
    const childrenOf = new Map([['root', ['a', 'b', 'c', 'd', 'e', 'f']]])
    const sizeOf = new Map<string, SizedNode>([['root', LEAF]])
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) sizeOf.set(id, LEAF)
    const positions = balancedLayout('root', childrenOf, sizeOf, 2, 5)

    const axis = (positions.get('root') as { x: number }).x + LEAF.width / 2
    const rightIds = ['a', 'c', 'e']
    const leftIds = ['b', 'd', 'f']
    for (const id of rightIds) {
      expect((positions.get(id) as { x: number }).x).toBeGreaterThanOrEqual(axis)
    }
    for (const id of leftIds) {
      expect((positions.get(id) as { x: number }).x + LEAF.width).toBeLessThanOrEqual(axis)
    }
  })
})

describe('boundsOfPositions', () => {
  it('computes the bounding box from positions and sizes together', () => {
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 100, y: 50 }],
    ])
    const sizeOf = new Map([
      ['a', { width: 10, height: 10 }],
      ['b', { width: 20, height: 20 }],
    ])
    expect(boundsOfPositions(positions, sizeOf)).toEqual({ minX: 0, minY: 0, maxX: 120, maxY: 70 })
  })
})
