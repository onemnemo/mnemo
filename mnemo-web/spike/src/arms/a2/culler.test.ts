// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { createCuller, type CullTarget } from './culler'

/**
 * The culler is load-bearing rather than an optimization: without it the engine's own paint walk
 * is proportional to how many boxes exist, and a pan showing one element measured 50ms a frame.
 * These tests weight the two properties that would fail silently — a target that is visible but
 * hidden, and per-frame work that quietly becomes proportional to the document.
 */

interface Fake {
  readonly target: CullTarget
  readonly node: { style: { display: string } }
}

function fake(key: string, x: number, y: number, width = 100, height = 40): Fake {
  const node = { style: { display: '' } }
  return {
    node,
    target: { key, nodes: [node], bounds: () => ({ x, y, width, height }) },
  }
}

/** 1600x900 at zoom 1 is a little under two cells wide, which is the common case. */
const VIEW = { width: 1600, height: 900 }

function visible(f: Fake): boolean {
  return f.node.style.display !== 'none'
}

describe('createCuller', () => {
  let origin: Fake
  let nearby: Fake
  let faraway: Fake
  let targets: CullTarget[]

  beforeEach(() => {
    origin = fake('a', 0, 0)
    nearby = fake('b', 1200, 400)
    faraway = fake('c', 400_000, 400_000)
    targets = [origin.target, nearby.target, faraway.target]
  })

  it('renders what the camera can see and hides what it cannot', () => {
    const culler = createCuller(targets, true)
    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)

    expect(visible(origin)).toBe(true)
    expect(visible(nearby)).toBe(true)
    expect(visible(faraway)).toBe(false)
    expect(culler.renderedCount()).toBe(2)
  })

  it('renders everything and stays out of the way when disabled', () => {
    const culler = createCuller(targets, false)
    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)

    expect(visible(faraway)).toBe(true)
    expect(culler.renderedCount()).toBe(targets.length)
  })

  it('does no work at all while the camera stays inside the same cells', () => {
    // The property the whole design rests on: most frames of a slow pan must cost nothing. If
    // this regresses, per-frame work silently becomes proportional to what is on screen.
    let boundsReads = 0
    const counted: CullTarget = {
      key: 'counted',
      nodes: [{ style: { display: '' } }],
      bounds: () => {
        boundsReads += 1
        return { x: 0, y: 0, width: 10, height: 10 }
      },
    }
    const culler = createCuller([counted], true)
    const afterIndexing = boundsReads

    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    for (let i = 0; i < 50; i++) culler.update({ x: i, y: 0, zoom: 1 }, VIEW.width, VIEW.height)

    expect(boundsReads).toBe(afterIndexing)
  })

  it('keeps a target visible while any of its cells is still in view', () => {
    // A frame is far larger than a cell and an edge can be longer still. Hiding one because the
    // first of its cells left the view would be a visible bug, not a saving.
    const wide = fake('wide', 0, 0, 6000, 40)
    const culler = createCuller([wide.target], true)

    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    expect(visible(wide)).toBe(true)
    culler.update({ x: 4000, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    expect(visible(wide)).toBe(true)
    culler.update({ x: 40_000, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    expect(visible(wide)).toBe(false)
  })

  it('shows more as the camera zooms out', () => {
    const spread = Array.from({ length: 20 }, (_, i) => fake(`s${i}`, i * 1500, 0))
    const culler = createCuller(
      spread.map((f) => f.target),
      true,
    )

    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    const atFullZoom = culler.renderedCount()
    culler.update({ x: 0, y: 0, zoom: 0.1 }, VIEW.width, VIEW.height)

    expect(culler.renderedCount()).toBeGreaterThan(atFullZoom)
  })

  it('keeps a pinned target rendered after it is carried out of view', () => {
    const culler = createCuller(targets, true)
    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    culler.pin(['a'])

    culler.update({ x: 500_000, y: 500_000, zoom: 1 }, VIEW.width, VIEW.height)
    expect(visible(origin)).toBe(true)

    culler.unpinAll()
    expect(visible(origin)).toBe(false)
  })

  it('does not hide a pinned target that is also genuinely in view', () => {
    // Reference counting rather than a boolean: unpinning must not override the camera.
    const culler = createCuller(targets, true)
    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)

    culler.pin(['a'])
    culler.unpinAll()

    expect(visible(origin)).toBe(true)
  })

  it('re-indexes from live bounds, so a relayout does not leave content hidden mid-view', () => {
    let x = 400_000
    const mover = { style: { display: '' } }
    const culler = createCuller(
      [{ key: 'mover', nodes: [mover], bounds: () => ({ x, y: 0, width: 100, height: 40 }) }],
      true,
    )

    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    expect(mover.style.display).toBe('none')

    x = 100
    culler.rebuild()
    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    expect(mover.style.display).not.toBe('none')
  })

  it('tracks visible edge ids so the canvas draw list costs nothing to read', () => {
    // The canvas mode reads this every frame. Deriving it instead (walk the rendered keys, slice
    // an id out of each) would cost the visible NODE count too and allocate per edge per frame,
    // which is work the SVG mode never does and would show up as canvas being slower than it is.
    const nearEdge: CullTarget = {
      key: 'e:near',
      edgeId: 'near',
      nodes: [{ style: { display: '' } }],
      bounds: () => ({ x: 0, y: 0, width: 100, height: 40 }),
    }
    const farEdge: CullTarget = {
      key: 'e:far',
      edgeId: 'far',
      nodes: [{ style: { display: '' } }],
      bounds: () => ({ x: 600_000, y: 0, width: 100, height: 40 }),
    }
    const culler = createCuller([origin.target, nearEdge, farEdge], true)
    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)

    const visible = culler.renderedEdgeIds()
    expect([...visible]).toEqual(['near'])
    // Elements are not edges: a node must never leak into the draw list.
    expect(visible.has('a')).toBe(false)
  })

  it('drops an edge from the draw list when it leaves the view, and restores it', () => {
    const edge: CullTarget = {
      key: 'e:1',
      edgeId: '1',
      nodes: [{ style: { display: '' } }],
      bounds: () => ({ x: 0, y: 0, width: 100, height: 40 }),
    }
    const culler = createCuller([edge], true)

    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    expect(culler.renderedEdgeIds().size).toBe(1)
    culler.update({ x: 900_000, y: 900_000, zoom: 1 }, VIEW.width, VIEW.height)
    expect(culler.renderedEdgeIds().size).toBe(0)
    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    expect(culler.renderedEdgeIds().size).toBe(1)
  })

  it('reports every edge as visible when culling is disabled', () => {
    // Otherwise the canvas mode would read an empty set and draw nothing, which is the single
    // most flattering way this arm could fail: a blank layer posts the best frame times there are.
    const edge: CullTarget = {
      key: 'e:1',
      edgeId: '1',
      nodes: [{ style: { display: '' } }],
      bounds: () => ({ x: 900_000, y: 0, width: 100, height: 40 }),
    }
    const culler = createCuller([edge], false)
    expect([...culler.renderedEdgeIds()]).toEqual(['1'])
  })

  it('toggles every node a target owns, so an edge label never outlives its path', () => {
    const path = { style: { display: '' } }
    const label = { style: { display: '' } }
    const culler = createCuller(
      [{ key: 'e1', nodes: [path, label], bounds: () => ({ x: 900_000, y: 0, width: 10, height: 10 }) }],
      true,
    )

    culler.update({ x: 0, y: 0, zoom: 1 }, VIEW.width, VIEW.height)
    expect(path.style.display).toBe('none')
    expect(label.style.display).toBe('none')
  })
})
