import { describe, expect, it } from 'vitest'

import {
  computeInventory,
  computeRelayout,
  generateFixture,
  generateFixtureWithRoles,
  logicalDigest,
  type DeliberateConstruction,
  type FixtureRoles,
  type Inventory,
} from './generate'
import { MATH_POOL_TALL, UNPARSEABLE_LATEX } from './internal/content'
import { fitZoom, MIN_SCALE, type FrameContent, type MindmapElement } from './model'

const FULL_SCALE = 5000
const CONTROL_SCALE = 100

/** S7 drags at zoom 0.5 in a 1600x900 window, so this is its canvas-space viewport. */
const S7_WINDOW_WIDTH = 1600 / 0.5
const S7_WINDOW_HEIGHT = 900 / 0.5

const forest5000 = generateFixtureWithRoles({ layout: 'forest', elementCount: FULL_SCALE, seed: 3 })
const denseGrid5000 = generateFixtureWithRoles({ layout: 'dense-grid', elementCount: FULL_SCALE, seed: 3 })

// ---- Geometry helpers used by the assertions below -------------------------------------------

function isFrame(e: MindmapElement): e is MindmapElement & { content: FrameContent } {
  return e.content.kind === 'frame'
}

function contains(outer: MindmapElement, inner: MindmapElement): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function disjoint(a: MindmapElement, b: MindmapElement): boolean {
  return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
}

function findRoot(id: string, parentOf: Readonly<Record<string, string>>): string {
  let current = id
  while (parentOf[current] !== undefined) current = parentOf[current]
  return current
}

function framesOf(elements: readonly MindmapElement[]): (MindmapElement & { content: FrameContent })[] {
  return elements.filter(isFrame)
}

function membersOf(
  elements: readonly MindmapElement[],
  frame: MindmapElement & { content: FrameContent },
): MindmapElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]))
  return frame.content.childIds.map((id) => byId.get(id)).filter((m): m is MindmapElement => m !== undefined)
}

function frameById(
  elements: readonly MindmapElement[],
  id: string,
): MindmapElement & { content: FrameContent } {
  const frame = framesOf(elements).find((f) => f.id === id)
  if (!frame) throw new Error(`frameById: no frame "${id}"`)
  return frame
}

// ---- computeInventory ---------------------------------------------------------------------

describe('computeInventory', () => {
  it('reproduces the literal spec exactly at elementCount 5000', () => {
    const inv = computeInventory(FULL_SCALE)
    expect(inv).toEqual<Inventory>({
      nodeText: 3600,
      nodeTask: 300,
      nodeCode: 100,
      nodeLink: 30,
      nodeRef: 120,
      nodeMath: 50,
      shape: 400,
      freeText: 300,
      image: 60,
      frame: 40,
    })
    // The plan's Ref bucket is 150 elements covering link, note and flashcard together.
    expect(inv.nodeLink + inv.nodeRef).toBe(150)
  })

  it('sums to elementCount exactly', () => {
    for (const n of [FULL_SCALE, CONTROL_SCALE, 777, 12000]) {
      const inv = computeInventory(n)
      const total = Object.values(inv).reduce((a, b) => a + b, 0)
      expect(total).toBe(n)
    }
  })

  it('keeps at least one of every kind and at least 2 frames at the 100-element control scale', () => {
    const inv = computeInventory(CONTROL_SCALE)
    for (const [key, value] of Object.entries(inv)) {
      expect(value, key).toBeGreaterThanOrEqual(key === 'frame' ? 2 : 1)
    }
  })

  it('throws rather than silently under-filling when elementCount is too small', () => {
    expect(() => computeInventory(5)).toThrow(/too small/)
  })

  it('throws on a non-positive elementCount', () => {
    expect(() => computeInventory(0)).toThrow()
    expect(() => computeInventory(-10)).toThrow()
  })
})

// ---- Determinism and the cross-engine digest pin ----------------------------------------------

/**
 * Checked in, not computed. `generateFixture(x) === generateFixture(x)` is tautological inside
 * one engine and would pass on V8 and JavaScriptCore even if they built completely different
 * documents, which is the exact failure the digest exists to catch. Pinning the value turns the
 * test into a real cross-engine check and makes any generator change a reviewed edit.
 */
const PINNED_DIGESTS: readonly { layout: 'forest' | 'dense-grid'; elementCount: number; seed: number; digest: string }[] = [
  { layout: 'forest', elementCount: FULL_SCALE, seed: 1, digest: '14d980fd68bbd0' },
  { layout: 'dense-grid', elementCount: FULL_SCALE, seed: 1, digest: '11420de6378d59' },
  { layout: 'forest', elementCount: FULL_SCALE, seed: 3, digest: '46badda86b0a8' },
  { layout: 'dense-grid', elementCount: FULL_SCALE, seed: 3, digest: 'c4e811bcefe9e' },
  { layout: 'forest', elementCount: CONTROL_SCALE, seed: 1, digest: '1307514f914e85' },
  { layout: 'dense-grid', elementCount: CONTROL_SCALE, seed: 1, digest: '2b4c8079cbbd5' },
]

describe('fixture digest', () => {
  it.each(PINNED_DIGESTS)('matches the pinned value for $layout $elementCount seed $seed', (pin) => {
    const fixture = generateFixture({ layout: pin.layout, elementCount: pin.elementCount, seed: pin.seed })
    expect(fixture.digest).toBe(pin.digest)
  })

  it('gives a different digest for a different seed', () => {
    const a = generateFixture({ layout: 'forest', elementCount: CONTROL_SCALE, seed: 1 })
    const b = generateFixture({ layout: 'forest', elementCount: CONTROL_SCALE, seed: 2 })
    expect(a.digest).not.toBe(b.digest)
  })

  it('produces byte-identical elements/edges across repeated builds, not just a matching digest', () => {
    // A hash collision would be a false pass; a full structural comparison is the real proof.
    const a = generateFixture({ layout: 'forest', elementCount: CONTROL_SCALE, seed: 123 })
    const b = generateFixture({ layout: 'forest', elementCount: CONTROL_SCALE, seed: 123 })
    expect(a.elements).toEqual(b.elements)
    expect(a.edges).toEqual(b.edges)
    expect(a.clusterRoots).toEqual(b.clusterRoots)
    expect(a.parentOf).toEqual(b.parentOf)
  })
})

// ---- Shared logical document ---------------------------------------------------------------

describe('forest and dense-grid share one logical document', () => {
  it('share a logical digest (position excluded) at the control scale', () => {
    const forest = generateFixture({ layout: 'forest', elementCount: CONTROL_SCALE, seed: 5 })
    const denseGrid = generateFixture({ layout: 'dense-grid', elementCount: CONTROL_SCALE, seed: 5 })
    expect(logicalDigest(forest)).toBe(logicalDigest(denseGrid))
    // The full digest (position included) must still differ, or the two layouts placed
    // everything identically, which would defeat the entire point of having two layouts.
    expect(forest.digest).not.toBe(denseGrid.digest)
  })

  it('share a logical digest at full scale, sizes included', () => {
    expect(logicalDigest(forest5000.fixture)).toBe(logicalDigest(denseGrid5000.fixture))
    expect(forest5000.fixture.digest).not.toBe(denseGrid5000.fixture.digest)
  })

  it('gives every frame the same size in both layouts', () => {
    // Frames are sized to their membership, so this is the load-bearing half of "same document,
    // different positions": a frame that changed size between layouts would make the two
    // fixtures different documents and the density comparison meaningless.
    const denseById = new Map(denseGrid5000.fixture.elements.map((e) => [e.id, e]))
    for (const frame of framesOf(forest5000.fixture.elements)) {
      const other = denseById.get(frame.id)
      expect(other?.width, frame.id).toBe(frame.width)
      expect(other?.height, frame.id).toBe(frame.height)
    }
  })

  it('actually repositions elements between the two layouts', () => {
    const denseById = new Map(denseGrid5000.fixture.elements.map((e) => [e.id, e]))
    const moved = forest5000.fixture.elements.filter((el) => {
      const other = denseById.get(el.id)
      return other !== undefined && (other.x !== el.x || other.y !== el.y)
    }).length
    expect(moved).toBeGreaterThan(forest5000.fixture.elements.length * 0.9)
  })
})

// ---- Inventory counts on the built fixture --------------------------------------------------

function countKinds(elements: readonly MindmapElement[]) {
  const counts = {
    nodeText: 0, nodeTask: 0, nodeCode: 0, nodeLink: 0, nodeRef: 0, nodeMath: 0,
    shape: 0, freeText: 0, image: 0, frame: 0,
  }
  for (const el of elements) {
    if (el.kind === 'node') {
      const k = el.content.kind
      if (k === 'text') counts.nodeText += 1
      else if (k === 'task') counts.nodeTask += 1
      else if (k === 'code') counts.nodeCode += 1
      else if (k === 'link') counts.nodeLink += 1
      else if (k === 'note' || k === 'flashcard') counts.nodeRef += 1
      else if (k === 'math') counts.nodeMath += 1
    } else if (el.kind === 'shape') counts.shape += 1
    else if (el.kind === 'text') counts.freeText += 1
    else if (el.kind === 'image') counts.image += 1
    else if (el.kind === 'frame') counts.frame += 1
  }
  return counts
}

describe('inventory counts on the generated fixture', () => {
  it('matches the literal spec at full scale', () => {
    expect(countKinds(forest5000.fixture.elements)).toEqual({
      nodeText: 3600, nodeTask: 300, nodeCode: 100, nodeLink: 30, nodeRef: 120, nodeMath: 50,
      shape: 400, freeText: 300, image: 60, frame: 40,
    })
    expect(forest5000.fixture.elements).toHaveLength(FULL_SCALE)
  })

  it('renders every node content kind, link included', () => {
    // A kind nothing generates is a render path nothing measures, and the arm passes every gate
    // without ever drawing it.
    const kinds = new Set(forest5000.fixture.elements.filter((e) => e.kind === 'node').map((e) => e.content.kind))
    expect([...kinds].sort()).toEqual(['code', 'flashcard', 'link', 'math', 'note', 'task', 'text'])
  })

  it('gives every link node a url and a title', () => {
    const links = forest5000.fixture.elements.filter((e) => e.content.kind === 'link')
    expect(links).toHaveLength(30)
    for (const link of links) {
      if (link.content.kind !== 'link') throw new Error('unreachable')
      expect(link.content.url).toMatch(/^https:\/\//)
      expect(link.content.title.length).toBeGreaterThan(0)
    }
  })

  it('has 4200 tree nodes across 20 clusters and 800 free elements at full scale', () => {
    const treeNodeCount = forest5000.fixture.elements.filter((e) => e.kind === 'node').length
    expect(treeNodeCount).toBe(4200)
    expect(forest5000.fixture.elements.length - treeNodeCount).toBe(800)
    expect(forest5000.fixture.clusterRoots).toHaveLength(20)
  })

  it('has one hierarchy edge per non-root tree node at full scale (4180)', () => {
    expect(forest5000.fixture.edges.filter((e) => e.kind === 'hierarchy')).toHaveLength(4180)
    expect(Object.keys(forest5000.fixture.parentOf)).toHaveLength(4180)
  })

  it('has 400 link edges split 120/120/160 straight/curve/orthogonal, 80 labelled, by default', () => {
    const links = forest5000.fixture.edges.filter((e) => e.kind === 'link')
    expect(links).toHaveLength(400)
    expect(links.filter((e) => e.routing === 'straight')).toHaveLength(120)
    expect(links.filter((e) => e.routing === 'curve')).toHaveLength(120)
    expect(links.filter((e) => e.routing === 'orthogonal')).toHaveLength(160)
    expect(links.filter((e) => e.label !== undefined)).toHaveLength(80)
  })

  it('produces 4000 link edges under edgeStress', () => {
    const fixture = generateFixture({ layout: 'forest', elementCount: FULL_SCALE, seed: 1, edgeStress: true })
    expect(fixture.edges.filter((e) => e.kind === 'link')).toHaveLength(4000)
  })

  it('has at least 40 link edges joining two non-Node elements', () => {
    const byId = new Map(forest5000.fixture.elements.map((e) => [e.id, e]))
    const nonNodeJoins = forest5000.fixture.edges.filter((e) => {
      if (e.kind !== 'link') return false
      return byId.get(e.fromId)?.kind !== 'node' && byId.get(e.toId)?.kind !== 'node'
    })
    expect(nonNodeJoins.length).toBeGreaterThanOrEqual(40)
  })

  it('keeps at least one of every kind and >=2 frames at the control scale', () => {
    const fixture = generateFixture({ layout: 'forest', elementCount: CONTROL_SCALE, seed: 1 })
    const counts = countKinds(fixture.elements)
    expect(Object.values(counts).every((c) => c >= 1)).toBe(true)
    expect(counts.frame).toBeGreaterThanOrEqual(2)
    expect(fixture.elements).toHaveLength(CONTROL_SCALE)
  })
})

// ---- Frame membership and geometry ------------------------------------------------------------

describe('frame membership (full scale)', () => {
  const frames = framesOf(forest5000.fixture.elements)

  it('has 40 frames in three tiers: 30 small, 8 medium, 2 of exactly 120', () => {
    expect(frames).toHaveLength(40)
    const sizes = frames.map((f) => f.content.childIds.length).sort((a, b) => a - b)
    // Small frames own a whole subtree, so their size is a subtree size inside the tier's 3-15
    // window rather than a drawn number.
    expect(sizes.filter((s) => s >= 3 && s <= 15)).toHaveLength(30)
    expect(sizes.filter((s) => s === 120)).toHaveLength(2)
    expect(sizes.filter((s) => s > 15 && s < 120)).toHaveLength(8)
  })

  it('never lets a frame contain a frame, or an element belong to two frames', () => {
    const byId = new Map(forest5000.fixture.elements.map((e) => [e.id, e]))
    const claimed = new Set<string>()
    for (const frame of frames) {
      for (const memberId of frame.content.childIds) {
        expect(claimed.has(memberId)).toBe(false)
        claimed.add(memberId)
        expect(byId.get(memberId)?.kind).not.toBe('frame')
      }
    }
  })
})

describe.each([
  ['forest', forest5000],
  ['dense-grid', denseGrid5000],
] as const)('frame geometry (%s)', (_name, built) => {
  const elements = built.fixture.elements
  const roles: FixtureRoles = built.roles
  const frames = framesOf(elements)

  it('draws the large majority of frames around their members', () => {
    const enclosing = frames.filter((f) => {
      const members = membersOf(elements, f)
      return members.length > 0 && members.every((m) => contains(f, m))
    })
    expect(enclosing.length).toBe(roles.containingFrameIds.length)
    expect(enclosing.length).toBeGreaterThan(frames.length * 0.7)
  })

  it('encloses every member of every frame designated as containing', () => {
    for (const frameId of roles.containingFrameIds) {
      const frame = frameById(elements, frameId)
      for (const member of membersOf(elements, frame)) {
        expect(contains(frame, member), `${frameId} should enclose ${member.id}`).toBe(true)
      }
    }
  })

  it('keeps the members-outside-the-rect case to the designated minority', () => {
    const outside = frames.filter((f) => {
      const members = membersOf(elements, f)
      return members.length > 0 && members.every((m) => disjoint(f, m))
    })
    expect(outside.map((f) => f.id).sort()).toEqual([...roles.detachedFrameIds].sort())
    expect(outside.length).toBeLessThan(frames.length / 2)
  })

  it('gives each designated cross-cluster frame one node per cluster across at least 3', () => {
    expect(roles.crossClusterFrameIds.length).toBeGreaterThanOrEqual(5)
    for (const frameId of roles.crossClusterFrameIds) {
      const members = membersOf(elements, frameById(elements, frameId))
      expect(members.every((m) => m.kind === 'node'), frameId).toBe(true)
      const clusters = new Set(members.map((m) => findRoot(m.id, built.fixture.parentOf)))
      expect(clusters.size, frameId).toBe(members.length)
      expect(clusters.size, frameId).toBeGreaterThanOrEqual(3)
    }
  })

  it('gives each designated mixed-kind frame a node, a shape, a text and an image', () => {
    expect(roles.mixedKindFrameIds.length).toBeGreaterThanOrEqual(2)
    for (const frameId of roles.mixedKindFrameIds) {
      const kinds = new Set(membersOf(elements, frameById(elements, frameId)).map((m) => m.kind))
      for (const required of ['node', 'shape', 'text', 'image'] as const) {
        expect(kinds.has(required), `${frameId} missing ${required}`).toBe(true)
      }
    }
  })

  it('puts every member of each designated outside-rect frame entirely outside its rect', () => {
    expect(roles.outsideRectFrameIds.length).toBeGreaterThanOrEqual(3)
    for (const frameId of roles.outsideRectFrameIds) {
      const frame = frameById(elements, frameId)
      const members = membersOf(elements, frame)
      expect(members.length, frameId).toBeGreaterThan(0)
      for (const member of members) {
        expect(disjoint(frame, member), `${frameId} should not touch ${member.id}`).toBe(true)
      }
    }
  })

  it('has exactly the designated elements sitting inside a frame they do not belong to', () => {
    const claimed = new Set(frames.flatMap((f) => f.content.childIds))
    const observed = elements
      .filter((e) => e.kind !== 'frame' && !claimed.has(e.id) && frames.some((f) => contains(f, e)))
      .map((e) => e.id)
      .sort()
    expect(observed).toEqual([...roles.orphanElementIds].sort())
    expect(observed.length).toBeGreaterThanOrEqual(4)
  })

  it('keeps a group-drag frame and 90% of its 120 members inside S7\'s viewport at once', () => {
    expect(roles.groupDragFrameIds.length).toBeGreaterThanOrEqual(2)
    for (const frameId of roles.groupDragFrameIds) {
      const frame = frameById(elements, frameId)
      const members = membersOf(elements, frame)
      expect(members).toHaveLength(120)

      const view: MindmapElement = {
        ...frame,
        x: frame.x + frame.width / 2 - S7_WINDOW_WIDTH / 2,
        y: frame.y + frame.height / 2 - S7_WINDOW_HEIGHT / 2,
        width: S7_WINDOW_WIDTH,
        height: S7_WINDOW_HEIGHT,
      }
      expect(contains(view, frame), frameId).toBe(true)
      const visible = members.filter((m) => contains(view, m)).length
      expect(visible, frameId).toBeGreaterThanOrEqual(108)
    }
  })
})

// ---- Falsification: each deliberate construction is load-bearing --------------------------------

/**
 * The point of these: every one of the structural properties above is the kind a random draw
 * satisfies by luck at a count nobody checks. Replacing the deliberate construction with the
 * naive draw it stands in for must make the matching assertion fail, or the assertion is
 * measuring nothing and could be deleted without anyone noticing.
 */
const DEFEATS: readonly { defeat: DeliberateConstruction; expected: RegExp }[] = [
  { defeat: 'frame-containment', expected: /frames enclose their members/ },
  { defeat: 'group-drag-locality', expected: /fit S7's viewport/ },
  { defeat: 'cross-cluster', expected: /cross-cluster frame .* non-node members/ },
  { defeat: 'mixed-kind', expected: /mixed-kind frame .* has no member of kind/ },
  { defeat: 'outside-rect', expected: /outside-rect frame .* members touching its own rect/ },
  { defeat: 'orphan', expected: /placed inside a frame they do not belong to/ },
]

describe.each(DEFEATS)('defeating $defeat', ({ defeat, expected }) => {
  it.each(['forest', 'dense-grid'] as const)('fails the fixture build in %s', (layout) => {
    expect(() => generateFixture({ layout, elementCount: FULL_SCALE, seed: 3, defeat })).toThrow(expected)
  })
})

// ---- DENSE-GRID board --------------------------------------------------------------------------

describe('dense-grid board', () => {
  it('overlaps nothing except a frame with its own members', () => {
    const elements = denseGrid5000.fixture.elements
    const owner = new Map<string, string>()
    for (const frame of framesOf(elements)) {
      for (const memberId of frame.content.childIds) owner.set(memberId, frame.id)
    }
    const orphanOwner = new Map<string, string>()
    for (const frame of framesOf(elements)) {
      for (const orphanId of denseGrid5000.roles.orphanElementIds) {
        const orphan = elements.find((e) => e.id === orphanId)
        if (orphan && contains(frame, orphan)) orphanOwner.set(orphanId, frame.id)
      }
    }

    const ordered = [...elements].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))
    const active: MindmapElement[] = []
    const collisions: string[] = []
    for (const element of ordered) {
      for (let i = active.length - 1; i >= 0; i -= 1) {
        const other = active[i]
        if (other.x + other.width <= element.x) {
          active.splice(i, 1)
          continue
        }
        const nested =
          owner.get(element.id) === other.id ||
          owner.get(other.id) === element.id ||
          orphanOwner.get(element.id) === other.id ||
          orphanOwner.get(other.id) === element.id
        if (!nested && !disjoint(element, other)) collisions.push(`${element.id}/${other.id}`)
      }
      active.push(element)
    }
    expect(collisions).toEqual([])
  })

  it('fits the viewport at a zoom above MIN_SCALE at full scale', () => {
    const { zoom, clampedToFloor } = fitZoom(denseGrid5000.fixture.bounds, 1600, 900)
    expect(clampedToFloor).toBe(false)
    expect(zoom).toBeGreaterThan(MIN_SCALE)
  })

  it('fits at a zoom above MIN_SCALE at the control scale', () => {
    const fixture = generateFixture({ layout: 'dense-grid', elementCount: CONTROL_SCALE, seed: 1 })
    const { zoom, clampedToFloor } = fitZoom(fixture.bounds, 1600, 900)
    expect(clampedToFloor).toBe(false)
    expect(zoom).toBeGreaterThan(MIN_SCALE)
  })

  it('puts every element on screen at once at full scale, so culling is inert', () => {
    const { bounds, elements } = denseGrid5000.fixture
    const { zoom } = fitZoom(bounds, 1600, 900)
    const view = {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.minX + 1600 / zoom,
      maxY: bounds.minY + 900 / zoom,
    }
    const onScreen = elements.filter(
      (e) => e.x < view.maxX && e.x + e.width > view.minX && e.y < view.maxY && e.y + e.height > view.minY,
    )
    expect(onScreen.length).toBe(elements.length)
  })

  it('the FOREST layout of the same document, by contrast, does not fit above the floor', () => {
    // This is the reason two layouts exist: a tidy-tree-packed 5000-node map genuinely
    // cannot be shown in full by the shipping product, so a benchmark built only on FOREST
    // would let viewport culling carry an arm to a meaningless pass.
    expect(fitZoom(forest5000.fixture.bounds, 1600, 900).clampedToFloor).toBe(true)
  })
})

// ---- Math content -----------------------------------------------------------------------------

describe('math content', () => {
  it('includes an empty string, the unparseable string, and several oversized expressions at full scale', () => {
    const latexValues = forest5000.fixture.elements
      .filter((e) => e.kind === 'node' && e.content.kind === 'math')
      .map((e) => (e.kind === 'node' && e.content.kind === 'math' ? e.content.latex : ''))

    expect(latexValues).toHaveLength(50)
    expect(latexValues).toContain('')
    expect(latexValues).toContain(UNPARSEABLE_LATEX)
    expect(latexValues.filter((l) => MATH_POOL_TALL.includes(l)).length).toBeGreaterThanOrEqual(3)
  })
})

// ---- computeRelayout --------------------------------------------------------------------------

describe('computeRelayout', () => {
  const fixture = generateFixture({ layout: 'forest', elementCount: CONTROL_SCALE, seed: 1 })

  it('returns a position for every tree node, root or not', () => {
    const relayout = computeRelayout(fixture, 999)
    const expectedIds = new Set([...fixture.clusterRoots, ...Object.keys(fixture.parentOf)])
    expect(relayout.size).toBe(expectedIds.size)
    for (const id of expectedIds) expect(relayout.has(id)).toBe(true)
  })

  it('moves most tree nodes to a different position', () => {
    const relayout = computeRelayout(fixture, 999)
    const byId = new Map(fixture.elements.map((e) => [e.id, e]))
    let moved = 0
    for (const [id, pos] of relayout) {
      const original = byId.get(id)
      if (original && (original.x !== pos.x || original.y !== pos.y)) moved += 1
    }
    expect(moved).toBeGreaterThan(relayout.size * 0.5)
  })

  it('is deterministic for a given relayout seed', () => {
    expect([...computeRelayout(fixture, 55)]).toEqual([...computeRelayout(fixture, 55)])
  })

  it('touches only tree nodes, never a free element', () => {
    const relayout = computeRelayout(fixture, 1)
    for (const el of fixture.elements) {
      if (el.kind !== 'node') expect(relayout.has(el.id)).toBe(false)
    }
  })

  it('leaves every relaid node inside its own cluster, so no node is yanked across the canvas', () => {
    // The orphan-inside-a-frame case is built from free elements precisely so this holds: a
    // tree node relocated into a distant frame would corrupt the Balanced layout it came from
    // and put a 14000px outlier into S9's relayout cost.
    const relayout = computeRelayout(fixture, 7)
    const byId = new Map(fixture.elements.map((e) => [e.id, e]))
    for (const [id, pos] of relayout) {
      const original = byId.get(id)
      if (!original) throw new Error(`unknown id ${id}`)
      expect(Math.abs(pos.x - original.x), id).toBeLessThan(4000)
      expect(Math.abs(pos.y - original.y), id).toBeLessThan(4000)
    }
  })
})
