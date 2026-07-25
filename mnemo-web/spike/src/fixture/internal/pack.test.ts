import { describe, expect, it } from 'vitest'

import { columnsForAspect, columnsForMaxRows, packCells, shelfPack, spanOf, type PackItem } from './pack'

const CELL = { cellWidth: 100, cellHeight: 50 }

function boxesOf(items: readonly PackItem[], positions: ReadonlyMap<string, { x: number; y: number }>) {
  return items.map((item) => {
    const pos = positions.get(item.id)
    if (!pos) throw new Error(`no position for ${item.id}`)
    return { id: item.id, x: pos.x, y: pos.y, width: item.width, height: item.height }
  })
}

interface Box {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function overlappingPairs(boxes: readonly Box[]): string[] {
  const pairs: string[] = []
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const disjoint =
        a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
      if (!disjoint) pairs.push(`${a.id}/${b.id}`)
    }
  }
  return pairs
}

describe('spanOf', () => {
  it('rounds up and never returns zero for a degenerate size', () => {
    expect(spanOf(100, 100)).toBe(1)
    expect(spanOf(101, 100)).toBe(2)
    expect(spanOf(0, 100)).toBe(1)
  })
})

describe('packCells', () => {
  it('places every item without overlap, mixed sizes included', () => {
    const items: PackItem[] = [
      ...Array.from({ length: 40 }, (_, i) => ({ id: `small${i}`, width: 90, height: 40 })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `big${i}`, width: 220, height: 180 })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `tall${i}`, width: 80, height: 300 })),
    ]
    const packed = packCells(items, { ...CELL, columns: 8 })
    expect(packed.positions.size).toBe(items.length)
    expect(overlappingPairs(boxesOf(items, packed.positions))).toEqual([])
  })

  it('is deterministic for the same input', () => {
    const items: PackItem[] = Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, width: 90 + i, height: 40 }))
    const a = packCells(items, { ...CELL, columns: 5 })
    const b = packCells(items, { ...CELL, columns: 5 })
    expect([...a.positions]).toEqual([...b.positions])
    expect(a.width).toBe(b.width)
    expect(a.height).toBe(b.height)
  })

  it('raises the column count to fit an item wider than the grid rather than dropping it', () => {
    const items: PackItem[] = [{ id: 'wide', width: 350, height: 40 }]
    const packed = packCells(items, { ...CELL, columns: 1 })
    expect(packed.positions.get('wide')).toEqual({ x: 0, y: 0 })
    expect(packed.width).toBe(400)
  })

  it('reports the extent used, not the full grid', () => {
    const items: PackItem[] = [
      { id: 'a', width: 100, height: 50 },
      { id: 'b', width: 100, height: 50 },
    ]
    const packed = packCells(items, { ...CELL, columns: 10 })
    expect(packed.width).toBe(200)
    expect(packed.height).toBe(50)
  })

  it('backfills a hole a tall item left beside it, so the board does not go sparse', () => {
    const items: PackItem[] = [
      { id: 'tall', width: 100, height: 200 },
      { id: 'a', width: 100, height: 50 },
      { id: 'b', width: 100, height: 50 },
    ]
    const packed = packCells(items, { ...CELL, columns: 2 })
    expect(packed.positions.get('a')).toEqual({ x: 100, y: 0 })
    expect(packed.positions.get('b')).toEqual({ x: 100, y: 50 })
    expect(packed.height).toBe(200)
  })

  it('handles an empty item list', () => {
    const packed = packCells([], { ...CELL, columns: 4 })
    expect(packed.positions.size).toBe(0)
    expect(packed.width).toBe(0)
    expect(packed.height).toBe(0)
  })
})

describe('columnsForAspect', () => {
  it('lands near the requested width-to-height ratio', () => {
    const items: PackItem[] = Array.from({ length: 400 }, (_, i) => ({ id: `i${i}`, width: 100, height: 50 }))
    const columns = columnsForAspect(items, CELL.cellWidth, CELL.cellHeight, 16 / 9)
    const packed = packCells(items, { ...CELL, columns })
    const aspect = packed.width / packed.height
    expect(aspect).toBeGreaterThan(1.4)
    expect(aspect).toBeLessThan(2.2)
  })

  it('never returns fewer columns than the widest item needs', () => {
    const items: PackItem[] = [{ id: 'wide', width: 500, height: 50 }]
    expect(columnsForAspect(items, CELL.cellWidth, CELL.cellHeight, 16 / 9)).toBeGreaterThanOrEqual(5)
  })
})

describe('columnsForMaxRows', () => {
  it('picks enough columns to keep the pack within the row budget', () => {
    const items: PackItem[] = Array.from({ length: 24 }, (_, i) => ({ id: `i${i}`, width: 100, height: 50 }))
    const columns = columnsForMaxRows(items, CELL.cellWidth, CELL.cellHeight, 6)
    const packed = packCells(items, { ...CELL, columns })
    expect(packed.height).toBeLessThanOrEqual(6 * CELL.cellHeight)
  })

  it('treats a zero or negative budget as one row rather than dividing by it', () => {
    const items: PackItem[] = Array.from({ length: 3 }, (_, i) => ({ id: `i${i}`, width: 100, height: 50 }))
    expect(columnsForMaxRows(items, CELL.cellWidth, CELL.cellHeight, 0)).toBe(3)
  })
})

describe('shelfPack', () => {
  it('wraps to a new row when the current one is full and never overlaps', () => {
    const boxes = [
      { id: 'a', width: 400, height: 100 },
      { id: 'b', width: 400, height: 200 },
      { id: 'c', width: 400, height: 100 },
    ]
    const packed = shelfPack(boxes, 900, 50)
    expect(packed.positions.get('a')).toEqual({ x: 0, y: 0 })
    expect(packed.positions.get('b')).toEqual({ x: 450, y: 0 })
    expect(packed.positions.get('c')).toEqual({ x: 0, y: 250 })
    expect(overlappingPairs(boxesOf(boxes, packed.positions))).toEqual([])
    expect(packed.height).toBe(350)
  })

  it('places a box wider than the row rather than looping forever', () => {
    const packed = shelfPack([{ id: 'huge', width: 5000, height: 100 }], 900, 50)
    expect(packed.positions.get('huge')).toEqual({ x: 0, y: 0 })
    expect(packed.width).toBe(5000)
  })
})
