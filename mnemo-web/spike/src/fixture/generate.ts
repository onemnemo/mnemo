/**
 * Builds the two Mindmap fixtures the spike compares: FOREST (a faithful Balanced-layout
 * tree) and DENSE-GRID (the same logical document packed so it fits on screen at once). Both
 * come from one document build so the comparison isolates spatial density from everything
 * else: only X/Y differ between the two, so a difference in the measurements can only be
 * explained by how densely the elements sit, not by a difference in what was measured.
 *
 * A frame here is a frame a user would recognise: it is drawn AROUND its members. Frames whose
 * members sit outside their rect exist too, because membership is an explicit id list and the
 * product must survive that, but they are a small designated set rather than the only shape the
 * fixture contains. Two deviations from the nominal fixture table fall out of that:
 *
 * - A frame that encloses its members cannot also be a fixed 320x220 box, so those frames are
 *   sized to their membership. Only the frames deliberately placed away from their members
 *   (the cross-cluster and outside-rect designations) keep the literal 320x220.
 * - A frame that encloses tree nodes owns a whole subtree, since a subtree is the only node set
 *   a tidy-tree layout puts in one contiguous region. Its member count is therefore a subtree
 *   size inside a tier's range rather than an exact target. The two group-drag frames own
 *   exactly 120 members, because those are free elements the generator places itself.
 *
 * A third deviation is in DENSE-GRID: the nominal fixed 176x84 pitch is smaller than the largest
 * element box, so it stacked every image and frame on top of its neighbours. The board is packed
 * instead, which is what "a hand-placed board" actually means, and the fit-above-the-zoom-floor
 * property the layout exists for is asserted rather than assumed to follow from the pitch.
 */

import type { Point } from '../harness/contract'
import { balancedLayout, boundsOfPositions, translateAll, type Point2, type SizedNode } from './internal/balanced-layout'
import {
  buildMathLatexPool,
  imageAssetId,
  lorem,
  loremSentence,
  pickCodeSnippet,
  refTargetId,
} from './internal/content'
import { computeContentDigest, computeDigest, type DigestDocument } from './internal/hash'
import {
  columnsForAspect,
  columnsForMaxRows,
  packCells,
  shelfPack,
  type PackItem,
  type PackResult,
} from './internal/pack'
import {
  boundsOf,
  fitZoom,
  MIN_SCALE,
  type Bounds,
  type ElementContent,
  type ElementKind,
  type EdgeRouting,
  type FixtureLayout,
  type FrameContent,
  type MindmapEdge,
  type MindmapElement,
  type MindmapFixture,
  type ShapeType,
} from './model'
import { chance, mulberry32, nextFloat, nextInt, pick, shuffle, type Rng } from './prng'

// ---- Scale model ------------------------------------------------------------------------
//
// Every quantity in the fixture (element counts, frame sizes, edge counts, structural
// minimums) is defined at elementCount 5000 and scaled by elementCount/5000. At exactly 5000
// this reproduces the literal spec numbers; below that, per-kind floors keep the "one of
// every kind, at least 2 frames" guarantee for a small control fixture, and the richer
// structural minimums (cross-cluster frames, orphan elements, ...) gracefully round down to
// zero rather than forcing a 100-element fixture to hold a 120-member frame.

const BASE_ELEMENT_COUNT = 5000
const BASE_CLUSTER_COUNT = 20
const BASE_FRAME_COUNT = 40
const BASE_FRAME_TIER_MEDIUM = 8
const BASE_FRAME_TIER_LARGE = 2
const BASE_FRAME_TIER2_TARGET = 40
const BASE_FRAME_TIER3_TARGET = 120
const BASE_LINK_EDGE_COUNT = 400
const BASE_LINK_EDGE_STRESS_COUNT = 4000

const BASE_STRUCTURAL_MIN = {
  crossCluster: 5,
  outsideRect: 3,
  mixedKind: 2,
  orphan: 4,
} as const

/** Tier-1 membership, the nominal "30 frames of 3-15 members". */
const TIER1_MIN_MEMBERS = 3
const TIER1_MAX_MEMBERS = 15

function scaleCount(base: number, elementCount: number): number {
  return Math.round((base * elementCount) / BASE_ELEMENT_COUNT)
}

function repeat<T>(value: T, count: number): T[] {
  return Array.from({ length: count }, () => value)
}

// ---- Sizes --------------------------------------------------------------------------------

const NODE_SIZE: SizedNode = { width: 132, height: 40 }
const SHAPE_SIZE: SizedNode = { width: 132, height: 76 }
const FREE_TEXT_SIZE: SizedNode = { width: 140, height: 36 }
const IMAGE_SIZE: SizedNode = { width: 320, height: 220 }
/** The plan's literal frame box, kept for the frames that are NOT drawn around their members. */
const DETACHED_FRAME_SIZE: SizedNode = { width: 320, height: 220 }

/** Breathing room between a frame's edge and its members, in both layouts. */
const FRAME_PADDING = 24
/** Cell grid for arranging members inside a frame. 168x44 holds a node with a gap, an image in 2x5. */
const FRAME_CELL_WIDTH = 168
const FRAME_CELL_HEIGHT = 44
const FRAME_STRIP_GAP = 16

const SHAPE_TYPES: readonly ShapeType[] = [
  'rectangle', 'ellipse', 'diamond', 'hexagon', 'parallelogram', 'line', 'arrow',
]

/** The harness's own window, and the zoom S7 drags at. Both are fixture constraints, not decoration. */
const SPIKE_VIEWPORT_WIDTH = 1600
const SPIKE_VIEWPORT_HEIGHT = 900
const GROUP_DRAG_ZOOM = 0.5
/** Share of a group-drag frame's members that must be on screen for S7 to measure a group drag. */
const GROUP_DRAG_VISIBLE_FRACTION = 0.9

// ---- Inventory ------------------------------------------------------------------------

export interface Inventory {
  readonly nodeText: number
  readonly nodeTask: number
  readonly nodeCode: number
  readonly nodeLink: number
  readonly nodeRef: number
  readonly nodeMath: number
  readonly shape: number
  readonly freeText: number
  readonly image: number
  readonly frame: number
}

/**
 * Scales the 5000-element inventory down (or up) to `elementCount`. node/text absorbs the
 * rounding drift from every other bucket because it is the largest bucket by a wide margin,
 * so nudging it by a few units does not change the fixture's character the way nudging, say,
 * the math count would.
 *
 * The plan's 150-element "Ref (link, note, flashcard)" bucket is split 30 link / 120 note-or-
 * flashcard here, so the link render path is actually exercised instead of being a dead
 * content kind nothing ever draws.
 */
export function computeInventory(elementCount: number): Inventory {
  if (!Number.isFinite(elementCount) || elementCount <= 0) {
    throw new Error(`computeInventory: elementCount must be a positive number, got ${elementCount}`)
  }

  const nodeTask = Math.max(1, scaleCount(300, elementCount))
  const nodeCode = Math.max(1, scaleCount(100, elementCount))
  const nodeLink = Math.max(1, scaleCount(30, elementCount))
  const nodeRef = Math.max(1, scaleCount(120, elementCount))
  const nodeMath = Math.max(1, scaleCount(50, elementCount))
  const shape = Math.max(1, scaleCount(400, elementCount))
  const freeText = Math.max(1, scaleCount(300, elementCount))
  const image = Math.max(1, scaleCount(60, elementCount))
  const frame = Math.max(2, scaleCount(BASE_FRAME_COUNT, elementCount))

  const fixedTotal = nodeTask + nodeCode + nodeLink + nodeRef + nodeMath + shape + freeText + image + frame
  if (fixedTotal + 1 > elementCount) {
    throw new Error(
      `computeInventory: elementCount ${elementCount} is too small to hold one element of every ` +
        `kind plus at least 2 frames (needs at least ${fixedTotal + 1})`,
    )
  }

  return {
    nodeText: elementCount - fixedTotal,
    nodeTask,
    nodeCode,
    nodeLink,
    nodeRef,
    nodeMath,
    shape,
    freeText,
    image,
    frame,
  }
}

function inventoryTotal(inv: Inventory): number {
  return (
    inv.nodeText + inv.nodeTask + inv.nodeCode + inv.nodeLink + inv.nodeRef + inv.nodeMath +
    inv.shape + inv.freeText + inv.image + inv.frame
  )
}

function computeClusterCount(elementCount: number): number {
  return Math.max(2, scaleCount(BASE_CLUSTER_COUNT, elementCount))
}

interface FrameTierPlan {
  readonly tier1Count: number
  readonly tier2Count: number
  readonly tier3Count: number
  readonly tier2Target: number
  readonly tier3Target: number
}

function computeFrameTierPlan(frameCount: number, elementCount: number): FrameTierPlan {
  const tier3Count = Math.min(Math.round((frameCount * BASE_FRAME_TIER_LARGE) / BASE_FRAME_COUNT), frameCount)
  const tier2Count = Math.min(Math.round((frameCount * BASE_FRAME_TIER_MEDIUM) / BASE_FRAME_COUNT), frameCount - tier3Count)
  const tier1Count = frameCount - tier2Count - tier3Count
  const tier2Target = Math.max(20, scaleCount(BASE_FRAME_TIER2_TARGET, elementCount))
  const tier3Target = Math.max(tier2Target + 10, scaleCount(BASE_FRAME_TIER3_TARGET, elementCount))
  return { tier1Count, tier2Count, tier3Count, tier2Target, tier3Target }
}

// ---- Tree construction ------------------------------------------------------------------

type NodeKindTag = 'text' | 'task' | 'code' | 'link' | 'ref' | 'math'

function buildNodeKindTags(inv: Inventory, rng: Rng): NodeKindTag[] {
  return shuffle(rng, [
    ...repeat<NodeKindTag>('text', inv.nodeText),
    ...repeat<NodeKindTag>('task', inv.nodeTask),
    ...repeat<NodeKindTag>('code', inv.nodeCode),
    ...repeat<NodeKindTag>('link', inv.nodeLink),
    ...repeat<NodeKindTag>('ref', inv.nodeRef),
    ...repeat<NodeKindTag>('math', inv.nodeMath),
  ])
}

interface ContentCursors {
  readonly math: { i: number }
  readonly ref: { i: number }
  readonly link: { i: number }
}

function buildNodeContent(
  tag: NodeKindTag,
  rng: Rng,
  mathPool: readonly string[],
  cursors: ContentCursors,
): ElementContent {
  switch (tag) {
    case 'text':
      return { kind: 'text', text: loremSentence(rng) }
    case 'task':
      return { kind: 'task', text: loremSentence(rng), done: chance(rng, 0.3) }
    case 'code': {
      const snippet = pickCodeSnippet(rng)
      return { kind: 'code', language: snippet.language, source: snippet.source }
    }
    case 'link': {
      const index = cursors.link.i
      cursors.link.i += 1
      // A stable synthetic origin: the renderer only ever shows the host and the title, and a
      // real URL would invite a fixture that quietly makes network requests during a measurement.
      return { kind: 'link', url: `https://example.org/ref/${index}`, title: lorem(rng, nextInt(rng, 2, 4)) }
    }
    case 'ref': {
      const refKind: 'note' | 'flashcard' = chance(rng, 0.6) ? 'note' : 'flashcard'
      const index = cursors.ref.i
      cursors.ref.i += 1
      const badge = refKind === 'flashcard' && chance(rng, 0.4) ? `${nextInt(rng, 1, 30)} due` : undefined
      const missing = chance(rng, 0.06) ? true : undefined
      return {
        kind: refKind,
        targetId: refTargetId(refKind, index),
        title: lorem(rng, nextInt(rng, 2, 4)),
        badge,
        missing,
      }
    }
    case 'math': {
      // mathPool is guaranteed non-empty whenever a math-tagged node exists: it is sized to
      // inv.nodeMath, and a math tag only occurs when inv.nodeMath > 0.
      const latex = mathPool[cursors.math.i % mathPool.length]
      cursors.math.i += 1
      return { kind: 'math', latex }
    }
  }
}

interface ClusterBuildResult {
  readonly elementShells: MindmapElement[]
  readonly clusterRoots: string[]
  readonly parentOf: Record<string, string>
  readonly childrenOf: Map<string, string[]>
  readonly nodesByCluster: Map<number, string[]>
  readonly clusterOfNode: Map<string, number>
  readonly sizeOf: Map<string, SizedNode>
}

/**
 * Builds `clusterCount` clusters totalling every node-kind element in `inventory`, each a
 * random recursive tree (every non-root node picks a uniformly random *existing* node in its
 * own cluster as parent). That gives varied branching and depth rather than a straight chain,
 * which is what actually exercises the Balanced packer's tidy-tree behaviour.
 */
function buildClusters(inventory: Inventory, clusterCount: number, rng: Rng): ClusterBuildResult {
  const treeNodeTotal =
    inventory.nodeText + inventory.nodeTask + inventory.nodeCode + inventory.nodeLink +
    inventory.nodeRef + inventory.nodeMath
  if (treeNodeTotal < clusterCount) {
    throw new Error(
      `buildClusters: ${treeNodeTotal} tree nodes cannot fill ${clusterCount} clusters with at least one node each`,
    )
  }

  const base = Math.floor(treeNodeTotal / clusterCount)
  const remainder = treeNodeTotal - base * clusterCount
  const clusterSizes = Array.from({ length: clusterCount }, (_, c) => base + (c < remainder ? 1 : 0))

  const tags = buildNodeKindTags(inventory, rng)
  const mathPool = buildMathLatexPool(inventory.nodeMath, rng)
  const cursors: ContentCursors = { math: { i: 0 }, ref: { i: 0 }, link: { i: 0 } }

  const elementShells: MindmapElement[] = []
  const clusterRoots: string[] = []
  const parentOf: Record<string, string> = {}
  const childrenOf = new Map<string, string[]>()
  const nodesByCluster = new Map<number, string[]>()
  const clusterOfNode = new Map<string, number>()
  const sizeOf = new Map<string, SizedNode>()

  let globalNodeIndex = 0
  let tagCursor = 0

  for (let c = 0; c < clusterCount; c += 1) {
    const size = clusterSizes[c]
    const idsInCluster: string[] = []

    for (let i = 0; i < size; i += 1) {
      const id = `n${globalNodeIndex}`
      globalNodeIndex += 1
      sizeOf.set(id, NODE_SIZE)
      clusterOfNode.set(id, c)

      if (i === 0) {
        clusterRoots.push(id)
      } else {
        const parent = pick(rng, idsInCluster)
        parentOf[id] = parent
        const kids = childrenOf.get(parent) ?? []
        kids.push(id)
        childrenOf.set(parent, kids)
      }
      idsInCluster.push(id)

      const tag = tags[tagCursor]
      tagCursor += 1
      const content = buildNodeContent(tag, rng, mathPool, cursors)
      elementShells.push({ id, kind: 'node', content, x: 0, y: 0, width: NODE_SIZE.width, height: NODE_SIZE.height })
    }

    nodesByCluster.set(c, idsInCluster)
  }

  return { elementShells, clusterRoots, parentOf, childrenOf, nodesByCluster, clusterOfNode, sizeOf }
}

// ---- Free elements ----------------------------------------------------------------------

interface FreeElementsResult {
  readonly shells: MindmapElement[]
  readonly shapeIds: string[]
  readonly freeTextIds: string[]
  readonly imageIds: string[]
}

function buildFreeElements(inventory: Inventory, rng: Rng, sizeOf: Map<string, SizedNode>): FreeElementsResult {
  const shells: MindmapElement[] = []
  const shapeIds: string[] = []
  const freeTextIds: string[] = []
  const imageIds: string[] = []

  for (let i = 0; i < inventory.shape; i += 1) {
    const id = `s${i}`
    const shapeType = SHAPE_TYPES[i % SHAPE_TYPES.length]
    const text = chance(rng, 0.5) ? lorem(rng, nextInt(rng, 1, 3)) : undefined
    shells.push({
      id, kind: 'shape', content: { kind: 'shape', shape: shapeType, text },
      x: 0, y: 0, width: SHAPE_SIZE.width, height: SHAPE_SIZE.height,
    })
    sizeOf.set(id, SHAPE_SIZE)
    shapeIds.push(id)
  }

  for (let i = 0; i < inventory.freeText; i += 1) {
    const id = `t${i}`
    shells.push({
      id, kind: 'text', content: { kind: 'freeText', text: loremSentence(rng) },
      x: 0, y: 0, width: FREE_TEXT_SIZE.width, height: FREE_TEXT_SIZE.height,
    })
    sizeOf.set(id, FREE_TEXT_SIZE)
    freeTextIds.push(id)
  }

  for (let i = 0; i < inventory.image; i += 1) {
    const id = `i${i}`
    shells.push({
      id, kind: 'image', content: { kind: 'image', assetId: imageAssetId(rng, i) },
      x: 0, y: 0, width: IMAGE_SIZE.width, height: IMAGE_SIZE.height,
    })
    sizeOf.set(id, IMAGE_SIZE)
    imageIds.push(id)
  }

  return { shells, shapeIds, freeTextIds, imageIds }
}

// ---- Tree geometry ------------------------------------------------------------------------

const CLUSTER_GUTTER = 500
const TREE_NODE_SPACING = 28
const TREE_RANK_SPACING = 90

interface TreeLayout {
  readonly positions: ReadonlyMap<string, Point2>
  readonly bounds: Bounds
}

/**
 * Lays every cluster out with the reimplemented Balanced algorithm and shelf-packs the clusters
 * onto a grid with generous gutters. Computed before frame membership is decided, because a
 * frame drawn around its members has to know where those members are, and because both layouts
 * must agree on frame SIZES (the logical digest covers width/height) even though only FOREST
 * uses these coordinates.
 */
function layoutForestTrees(
  clusterRoots: readonly string[],
  childrenOf: ReadonlyMap<string, readonly string[]>,
  sizeOf: ReadonlyMap<string, SizedNode>,
): TreeLayout {
  const positions = new Map<string, Point2>()

  const clusterLayouts = clusterRoots.map((rootId) => {
    const local = balancedLayout(rootId, childrenOf, sizeOf, TREE_NODE_SPACING, TREE_RANK_SPACING)
    const rootLocal = local.get(rootId)
    if (!rootLocal) throw new Error(`layoutForestTrees: balanced layout produced no position for root "${rootId}"`)
    translateAll(local, -rootLocal.x, -rootLocal.y)
    return { rootId, local, bbox: boundsOfPositions(local, sizeOf) }
  })

  const perRow = Math.max(1, Math.ceil(Math.sqrt(clusterLayouts.length)))
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  clusterLayouts.forEach((cluster, idx) => {
    if (idx > 0 && idx % perRow === 0) {
      cursorX = 0
      cursorY += rowHeight + CLUSTER_GUTTER
      rowHeight = 0
    }
    const offsetX = cursorX - cluster.bbox.minX
    const offsetY = cursorY - cluster.bbox.minY
    for (const [id, pos] of cluster.local) positions.set(id, { x: pos.x + offsetX, y: pos.y + offsetY })

    const width = cluster.bbox.maxX - cluster.bbox.minX
    const height = cluster.bbox.maxY - cluster.bbox.minY
    cursorX += width + CLUSTER_GUTTER
    rowHeight = Math.max(rowHeight, height)
  })

  return { positions, bounds: boundsOfPositions(positions, sizeOf) }
}

function boundsOfIds(
  ids: readonly string[],
  positions: ReadonlyMap<string, Point2>,
  sizeOf: ReadonlyMap<string, SizedNode>,
): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of ids) {
    const pos = positions.get(id)
    const size = sizeOf.get(id)
    if (!pos || !size) throw new Error(`boundsOfIds: "${id}" has no position or no size`)
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + size.width)
    maxY = Math.max(maxY, pos.y + size.height)
  }
  return { minX, minY, maxX, maxY }
}

/** Post-order subtree sizes for every tree node, computed iteratively so deep clusters cannot blow the stack. */
function computeSubtreeSizes(
  clusterRoots: readonly string[],
  childrenOf: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const rootId of clusterRoots) {
    const order = flattenSubtree(rootId, childrenOf)
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const id = order[i]
      let size = 1
      for (const kid of childrenOf.get(id) ?? []) size += sizes.get(kid) ?? 0
      sizes.set(id, size)
    }
  }
  return sizes
}

function flattenSubtree(rootId: string, childrenOf: ReadonlyMap<string, readonly string[]>): string[] {
  const result: string[] = []
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    result.push(id)
    const kids = childrenOf.get(id) ?? []
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i])
  }
  return result
}

// ---- Frame planning -------------------------------------------------------------------------
//
// Membership is an explicit id list, never derived from geometry, so which elements belong to
// which frame is decided once here and is the same in both layouts. Where those members SIT is
// per-layout, and the frame's rect follows them: a frame drawn around a tidy-tree subtree in
// FOREST is the same frame, at the same size, drawn around the same members packed into the
// board in DENSE-GRID.

/** What a frame is in the fixture for. Every role is constructed deliberately and asserted by id. */
type FrameRole =
  | 'generic'
  | 'large'
  | 'group-drag'
  | 'mixed-kind'
  | 'cross-cluster'
  | 'outside-rect'
  | 'orphan-host'

type FramePlacement = 'contain' | 'detached'

/**
 * A deliberate construction the generator performs, which can be replaced by the naive random
 * draw it stands in for. The suite builds a fixture with each one defeated and requires the
 * matching assertion to throw, which is what stops a structural property from being satisfied
 * by accident at a count nobody notices.
 */
export type DeliberateConstruction =
  | 'frame-containment'
  | 'group-drag-locality'
  | 'cross-cluster'
  | 'mixed-kind'
  | 'outside-rect'
  | 'orphan'

interface FramePlan {
  readonly id: string
  readonly role: FrameRole
  readonly placement: FramePlacement
  readonly nodeMemberIds: readonly string[]
  readonly freeMemberIds: readonly string[]
  /** Elements placed inside this frame's rect that belong to no frame. */
  readonly guestIds: readonly string[]
  readonly childIds: readonly string[]
  readonly width: number
  readonly height: number
  /** Member and guest offsets from the frame's interior origin. Used by DENSE-GRID always. */
  readonly interiorOffsets: ReadonlyMap<string, Point2>
  /** FOREST-only: where free members sit beside tree members that the packer already placed. */
  readonly forestStripOffsets: ReadonlyMap<string, Point2>
  /** FOREST top-left. Undefined means "no tree members to sit around", so the band places it. */
  readonly forestAnchor: Point2 | undefined
}

export interface FixtureRoles {
  /** Frames whose rect encloses every member and guest. The ordinary case, and the majority. */
  readonly containingFrameIds: readonly string[]
  /** Frames deliberately placed away from their members. The counted pathological minority. */
  readonly detachedFrameIds: readonly string[]
  readonly crossClusterFrameIds: readonly string[]
  readonly outsideRectFrameIds: readonly string[]
  readonly mixedKindFrameIds: readonly string[]
  /** The frames S7 drags: 120 members each, spatially local, on screen together at S7's zoom. */
  readonly groupDragFrameIds: readonly string[]
  /** Elements sitting inside a frame's rect while belonging to no frame. */
  readonly orphanElementIds: readonly string[]
}

interface FramePlanningInput {
  readonly frameIds: readonly string[]
  readonly tierPlan: FrameTierPlan
  readonly elementCount: number
  readonly clusterCount: number
  readonly clusterRoots: readonly string[]
  readonly childrenOf: ReadonlyMap<string, readonly string[]>
  readonly clusterOfNode: ReadonlyMap<string, number>
  readonly nodesByCluster: ReadonlyMap<number, readonly string[]>
  readonly shapeIds: readonly string[]
  readonly freeTextIds: readonly string[]
  readonly imageIds: readonly string[]
  readonly sizeOf: ReadonlyMap<string, SizedNode>
  readonly treeLayout: TreeLayout
  readonly defeat: DeliberateConstruction | undefined
  readonly rng: Rng
}

interface FramePlanningResult {
  readonly plans: readonly FramePlan[]
  readonly roles: FixtureRoles
}

function toPackItems(ids: readonly string[], sizeOf: ReadonlyMap<string, SizedNode>): PackItem[] {
  return ids.map((id) => {
    const size = sizeOf.get(id)
    if (!size) throw new Error(`toPackItems: no size registered for "${id}"`)
    return { id, width: size.width, height: size.height }
  })
}

/**
 * Packs items into as many columns as it takes to stay within `maxHeight`. Height is the
 * constrained axis for a frame around a tidy-tree subtree: the band above and below belongs to
 * the neighbouring subtree, so a frame that grows downward swallows nodes that belong to no
 * frame, while the space it grows sideways into is empty.
 */
function packWithinHeight(items: readonly PackItem[], maxHeight: number): PackResult {
  const cells = { cellWidth: FRAME_CELL_WIDTH, cellHeight: FRAME_CELL_HEIGHT }
  if (items.length === 0) return packCells(items, { ...cells, columns: 1 })

  const maxRows = Math.max(1, Math.floor(maxHeight / FRAME_CELL_HEIGHT))
  let columns = columnsForMaxRows(items, FRAME_CELL_WIDTH, FRAME_CELL_HEIGHT, maxRows)
  let packed = packCells(items, { ...cells, columns })
  // A multi-cell box can force a row the column estimate did not account for, so widen until it
  // fits. One column per item is the floor, where the height is just the tallest single box.
  for (let attempt = 0; attempt < items.length && packed.height > maxHeight; attempt += 1) {
    columns += 1
    packed = packCells(items, { ...cells, columns })
  }
  return packed
}

/** Geometry for a frame drawn around tree members, and optionally a strip of free members beside them. */
function planContainingGeometry(
  nodeMemberIds: readonly string[],
  freeMemberIds: readonly string[],
  guestIds: readonly string[],
  sizeOf: ReadonlyMap<string, SizedNode>,
  treeLayout: TreeLayout,
  clusterRootX: number,
): Pick<FramePlan, 'width' | 'height' | 'interiorOffsets' | 'forestStripOffsets' | 'forestAnchor'> {
  const box = boundsOfIds(nodeMemberIds, treeLayout.positions, sizeOf)
  const treeWidth = box.maxX - box.minX
  const treeHeight = box.maxY - box.minY
  // Free members go in a strip beside the tree members rather than on top of them. It wraps
  // into columns instead of growing taller, for the same reason the frame does.
  const stripItems = toPackItems(freeMemberIds, sizeOf)
  const packedStrip = packWithinHeight(stripItems, treeHeight)
  const stripWidth = stripItems.length > 0 ? packedStrip.width : 0
  const stripHeight = stripItems.length > 0 ? packedStrip.height : 0

  const items = toPackItems([...nodeMemberIds, ...freeMemberIds, ...guestIds], sizeOf)
  const packed = packWithinHeight(items, treeHeight)

  const stripSpan = stripWidth > 0 ? FRAME_STRIP_GAP + stripWidth : 0
  const interiorWidth = Math.max(treeWidth + stripSpan, packed.width)
  const interiorHeight = Math.max(treeHeight, packed.height, stripHeight)
  const width = interiorWidth + 2 * FRAME_PADDING
  const height = interiorHeight + 2 * FRAME_PADDING

  // Everything the frame adds beyond its members' own box hangs over the gutter between this
  // cluster and the next one. Past the gutter it starts enclosing a neighbouring cluster's
  // nodes, which belong to no frame, so the budget is a hard limit rather than a preference.
  const overhang = FRAME_PADDING + interiorWidth - treeWidth
  if (overhang > CLUSTER_GUTTER) {
    throw new Error(
      `planContainingGeometry: frame geometry overhangs its members' box by ${overhang}px, past the ` +
        `${CLUSTER_GUTTER}px cluster gutter, so it would enclose nodes from the neighbouring cluster`,
    )
  }

  // A tidy-tree subtree owns its whole cross band, so the space beyond its deepest rank (away
  // from the cluster root) is empty and the frame can grow into it. The band above and below
  // belongs to the neighbouring subtree, which is why the interior height never exceeds the
  // subtree's own height and the strip goes sideways rather than underneath.
  const growsRight = box.minX >= clusterRootX
  const forestAnchor: Point2 = growsRight
    ? { x: box.minX - FRAME_PADDING, y: box.minY - FRAME_PADDING }
    : { x: box.maxX + FRAME_PADDING - width, y: box.minY - FRAME_PADDING }

  const stripX = growsRight ? width - FRAME_PADDING - stripWidth : FRAME_PADDING
  const forestStripOffsets = new Map<string, Point2>()
  for (const [id, offset] of packedStrip.positions) {
    forestStripOffsets.set(id, { x: stripX + offset.x, y: FRAME_PADDING + offset.y })
  }

  return { width, height, interiorOffsets: packed.positions, forestStripOffsets, forestAnchor }
}

/** Geometry for a frame whose members are all free elements, so the generator places them itself. */
function planFreeGeometry(
  memberIds: readonly string[],
  guestIds: readonly string[],
  sizeOf: ReadonlyMap<string, SizedNode>,
): Pick<FramePlan, 'width' | 'height' | 'interiorOffsets' | 'forestStripOffsets' | 'forestAnchor'> {
  const items = toPackItems([...memberIds, ...guestIds], sizeOf)
  const columns = columnsForAspect(
    items,
    FRAME_CELL_WIDTH,
    FRAME_CELL_HEIGHT,
    SPIKE_VIEWPORT_WIDTH / SPIKE_VIEWPORT_HEIGHT,
  )
  const packed = packCells(items, { cellWidth: FRAME_CELL_WIDTH, cellHeight: FRAME_CELL_HEIGHT, columns })
  return {
    width: packed.width + 2 * FRAME_PADDING,
    height: packed.height + 2 * FRAME_PADDING,
    interiorOffsets: packed.positions,
    forestStripOffsets: new Map(),
    forestAnchor: undefined,
  }
}

function planFrames(input: FramePlanningInput): FramePlanningResult {
  const {
    frameIds, tierPlan, elementCount, clusterCount, clusterRoots, childrenOf, clusterOfNode,
    nodesByCluster, shapeIds, freeTextIds, imageIds, sizeOf, treeLayout, defeat, rng,
  } = input

  const tier1Ids = frameIds.slice(0, tierPlan.tier1Count)
  const tier2Ids = frameIds.slice(tierPlan.tier1Count, tierPlan.tier1Count + tierPlan.tier2Count)
  const tier3Ids = frameIds.slice(tierPlan.tier1Count + tierPlan.tier2Count)

  const crossClusterMin = Math.min(scaleCount(BASE_STRUCTURAL_MIN.crossCluster, elementCount), tier1Ids.length)
  const outsideRectMin = Math.min(scaleCount(BASE_STRUCTURAL_MIN.outsideRect, elementCount), tier1Ids.length)
  const mixedKindMin = Math.min(scaleCount(BASE_STRUCTURAL_MIN.mixedKind, elementCount), tier1Ids.length)
  const orphanMin = scaleCount(BASE_STRUCTURAL_MIN.orphan, elementCount)
  const orphanHostCount = orphanMin > 0 ? 1 : 0

  if (crossClusterMin > 0 && clusterCount < 3) {
    throw new Error(
      `planFrames: the cross-cluster minimum (${crossClusterMin}) needs >=3 clusters, only have ${clusterCount}`,
    )
  }
  if (mixedKindMin + crossClusterMin + outsideRectMin + orphanHostCount > tier1Ids.length) {
    throw new Error('planFrames: not enough small frames to cover every designated structural role')
  }

  let cursor = 0
  const mixedKindIds = tier1Ids.slice(cursor, cursor + mixedKindMin)
  cursor += mixedKindMin
  const crossClusterIds = tier1Ids.slice(cursor, cursor + crossClusterMin)
  cursor += crossClusterMin
  const outsideRectIds = tier1Ids.slice(cursor, cursor + outsideRectMin)
  cursor += outsideRectMin
  const orphanHostIds = tier1Ids.slice(cursor, cursor + orphanHostCount)
  cursor += orphanHostCount
  const genericIds = tier1Ids.slice(cursor)

  const claimed = new Set<string>()
  const subtreeSizes = computeSubtreeSizes(clusterRoots, childrenOf)
  const rootPosition = new Map<string, Point2>()
  for (const rootId of clusterRoots) {
    const pos = treeLayout.positions.get(rootId)
    if (!pos) throw new Error(`planFrames: cluster root "${rootId}" has no laid-out position`)
    rootPosition.set(rootId, pos)
  }

  // Candidate roots in one fixed shuffled order, so which subtree a frame gets is seeded rather
  // than an artifact of node numbering (which would put every frame in the first clusters).
  const subtreeCandidates = shuffle(rng, [...clusterRoots.flatMap((rootId) => flattenSubtree(rootId, childrenOf))])

  const tryClaimSubtree = (minSize: number, maxSize: number, minBoxHeight: number): string[] | undefined => {
    for (const candidateId of subtreeCandidates) {
      const size = subtreeSizes.get(candidateId) ?? 0
      if (size < minSize || size > maxSize) continue
      const nodes = flattenSubtree(candidateId, childrenOf)
      if (nodes.some((id) => claimed.has(id))) continue
      const box = boundsOfIds(nodes, treeLayout.positions, sizeOf)
      if (box.maxY - box.minY < minBoxHeight) continue
      for (const id of nodes) claimed.add(id)
      return nodes
    }
    return undefined
  }

  /**
   * Claims a whole subtree, which is the only node set a tidy-tree layout puts in one
   * contiguous region and therefore the only one a frame can be drawn around without also
   * swallowing nodes that belong to no frame. Member counts come from the windows rather than
   * from an exact target for that reason.
   */
  const claimSubtree = (windows: readonly (readonly [number, number])[], minBoxHeight = 0): string[] => {
    for (const [minSize, maxSize] of windows) {
      const claimedNodes = tryClaimSubtree(minSize, maxSize, minBoxHeight)
      if (claimedNodes) return claimedNodes
    }
    const described = windows.map(([lo, hi]) => `${lo}-${hi}`).join(' or ')
    throw new Error(
      `planFrames: no unclaimed subtree of ${described} nodes and at least ${minBoxHeight}px tall remains`,
    )
  }

  const tier1Windows: readonly (readonly [number, number])[] = [
    [TIER1_MIN_MEMBERS, TIER1_MAX_MEMBERS],
    [TIER1_MIN_MEMBERS, TIER1_MAX_MEMBERS * 2],
    [2, TIER1_MAX_MEMBERS * 4],
  ]
  const tier2Windows: readonly (readonly [number, number])[] = [
    [Math.round(tierPlan.tier2Target * 0.7), Math.round(tierPlan.tier2Target * 1.5)],
    [Math.round(tierPlan.tier2Target * 0.5), tierPlan.tier2Target * 2],
    [TIER1_MAX_MEMBERS + 1, tierPlan.tier2Target * 4],
  ]

  // One taker per pool, all sharing `claimed`, so a frame that must own a Shape AND a Text AND
  // an Image asks for each by kind instead of drawing from a mixed bag and hoping.
  const makeTaker = (label: string, pool: readonly string[]): ((count: number) => string[]) => {
    const ordered = shuffle(rng, [...pool])
    let cursor = 0
    return (count: number): string[] => {
      const taken: string[] = []
      while (taken.length < count) {
        if (cursor >= ordered.length) {
          throw new Error(`planFrames: ran out of unclaimed ${label} elements, needed ${count - taken.length} more`)
        }
        const id = ordered[cursor]
        cursor += 1
        if (claimed.has(id)) continue
        claimed.add(id)
        taken.push(id)
      }
      return taken
    }
  }

  const takeFree = makeTaker('free', [...shapeIds, ...freeTextIds])
  const takeShape = makeTaker('shape', shapeIds)
  const takeText = makeTaker('free-text', freeTextIds)
  const takeImage = makeTaker('image', imageIds)

  const plans: FramePlan[] = []
  const addPlan = (
    id: string,
    role: FrameRole,
    intendedPlacement: FramePlacement,
    nodeMemberIds: readonly string[],
    freeMemberIds: readonly string[],
    guestIds: readonly string[],
    geometry: Pick<FramePlan, 'width' | 'height' | 'interiorOffsets' | 'forestStripOffsets' | 'forestAnchor'>,
  ): void => {
    const containmentDefeated =
      defeat === 'frame-containment' && (role === 'generic' || role === 'large' || role === 'mixed-kind')
    plans.push({
      id,
      role,
      placement: containmentDefeated ? 'detached' : intendedPlacement,
      nodeMemberIds,
      freeMemberIds,
      guestIds,
      childIds: [...nodeMemberIds, ...freeMemberIds],
      ...geometry,
    })
  }

  const detachedGeometry = {
    width: DETACHED_FRAME_SIZE.width,
    height: DETACHED_FRAME_SIZE.height,
    interiorOffsets: new Map<string, Point2>(),
    forestStripOffsets: new Map<string, Point2>(),
    forestAnchor: undefined,
  }

  const clusterRootXOf = (nodeId: string): number => {
    const clusterIndex = clusterOfNode.get(nodeId)
    if (clusterIndex === undefined) throw new Error(`planFrames: "${nodeId}" belongs to no cluster`)
    const rootId = clusterRoots[clusterIndex]
    const pos = rootPosition.get(rootId)
    if (!pos) throw new Error(`planFrames: cluster root "${rootId}" has no laid-out position`)
    return pos.x
  }

  // Group-drag frames own free elements rather than a subtree, because the generator places
  // free elements itself and can therefore pack 120 of them into one block small enough to fit
  // S7's viewport whole. A 120-node subtree is a ribbon several viewports tall, which is the
  // difference between S7 measuring a group drag and S7 measuring the six members on screen.
  for (const frameId of tier3Ids) {
    if (defeat === 'group-drag-locality') {
      const scattered = takeFree(tierPlan.tier3Target)
      addPlan(frameId, 'group-drag', 'detached', [], scattered, [], detachedGeometry)
      continue
    }
    const members = takeFree(tierPlan.tier3Target)
    addPlan(frameId, 'group-drag', 'contain', [], members, [], planFreeGeometry(members, [], sizeOf))
  }

  for (const frameId of tier2Ids) {
    const members = claimSubtree(tier2Windows)
    addPlan(
      frameId, 'large', 'contain', members, [], [],
      planContainingGeometry(members, [], [], sizeOf, treeLayout, clusterRootXOf(members[0])),
    )
  }

  for (const frameId of mixedKindIds) {
    if (defeat === 'mixed-kind') {
      const members = claimSubtree(tier1Windows)
      addPlan(
        frameId, 'mixed-kind', 'contain', members, [], [],
        planContainingGeometry(members, [], [], sizeOf, treeLayout, clusterRootXOf(members[0])),
      )
      continue
    }
    const freeMembers = [...takeShape(1), ...takeText(1), ...takeImage(1)]
    // The strip beside the tree members may only grow sideways as far as the gutter allows, so
    // the subtree has to be at least as tall as the strip packed into its narrowest form. The
    // free members also count against this frame's tier-1 membership budget.
    const narrowestStrip = packCells(toPackItems(freeMembers, sizeOf), {
      cellWidth: FRAME_CELL_WIDTH,
      cellHeight: FRAME_CELL_HEIGHT,
      columns: 1,
    })
    const nodeBudget = Math.max(TIER1_MIN_MEMBERS, TIER1_MAX_MEMBERS - freeMembers.length)
    const nodeMembers = claimSubtree(
      [[TIER1_MIN_MEMBERS, nodeBudget], [TIER1_MIN_MEMBERS, nodeBudget * 2], [2, nodeBudget * 4]],
      narrowestStrip.height,
    )
    addPlan(
      frameId, 'mixed-kind', 'contain', nodeMembers, freeMembers, [],
      planContainingGeometry(nodeMembers, freeMembers, [], sizeOf, treeLayout, clusterRootXOf(nodeMembers[0])),
    )
  }

  for (const frameId of outsideRectIds) {
    const members = claimSubtree(tier1Windows)
    if (defeat === 'outside-rect') {
      addPlan(
        frameId, 'outside-rect', 'contain', members, [], [],
        planContainingGeometry(members, [], [], sizeOf, treeLayout, clusterRootXOf(members[0])),
      )
      continue
    }
    addPlan(frameId, 'outside-rect', 'detached', members, [], [], detachedGeometry)
  }

  for (const frameId of orphanHostIds) {
    const members = takeFree(nextInt(rng, TIER1_MIN_MEMBERS, TIER1_MAX_MEMBERS))
    const guests = defeat === 'orphan' ? [] : takeFree(orphanMin)
    addPlan(frameId, 'orphan-host', 'contain', [], members, guests, planFreeGeometry(members, guests, sizeOf))
  }

  for (const frameId of genericIds) {
    const members = claimSubtree(tier1Windows)
    addPlan(
      frameId, 'generic', 'contain', members, [], [],
      planContainingGeometry(members, [], [], sizeOf, treeLayout, clusterRootXOf(members[0])),
    )
  }

  // Cross-cluster frames last, so their one-node-per-cluster picks come out of what the subtree
  // frames left rather than punching holes in subtrees the containing frames still need.
  for (const frameId of crossClusterIds) {
    const wanted = Math.min(nextInt(rng, 3, TIER1_MAX_MEMBERS), clusterCount)
    if (defeat === 'cross-cluster') {
      const members = takeFree(wanted)
      addPlan(frameId, 'cross-cluster', 'detached', [], members, [], detachedGeometry)
      continue
    }
    const members = claimOneNodePerCluster(nodesByCluster, claimed, wanted, rng)
    addPlan(frameId, 'cross-cluster', 'detached', members, [], [], detachedGeometry)
  }

  const byId = new Map(plans.map((plan) => [plan.id, plan]))
  const orderedPlans = frameIds.map((id) => {
    const plan = byId.get(id)
    if (!plan) throw new Error(`planFrames: frame "${id}" was never planned`)
    return plan
  })

  const roles: FixtureRoles = {
    containingFrameIds: orderedPlans.filter((p) => p.placement === 'contain').map((p) => p.id),
    detachedFrameIds: orderedPlans.filter((p) => p.placement === 'detached').map((p) => p.id),
    crossClusterFrameIds: crossClusterIds,
    outsideRectFrameIds: outsideRectIds,
    mixedKindFrameIds: mixedKindIds,
    groupDragFrameIds: tier3Ids,
    orphanElementIds: orderedPlans.flatMap((p) => p.guestIds),
  }

  return { plans: orderedPlans, roles }
}

/**
 * One unclaimed node from each of `count` distinct clusters. Every member in its own cluster is
 * what makes this frame's cross-cluster span deliberate: a random draw of the same size spans
 * three or more clusters almost every time, so counting clusters alone would prove nothing.
 */
function claimOneNodePerCluster(
  nodesByCluster: ReadonlyMap<number, readonly string[]>,
  claimed: Set<string>,
  count: number,
  rng: Rng,
): string[] {
  const clusterOrder = shuffle(rng, [...nodesByCluster.keys()])
  const chosen: string[] = []
  for (const clusterIndex of clusterOrder) {
    if (chosen.length >= count) break
    const available = (nodesByCluster.get(clusterIndex) ?? []).filter((id) => !claimed.has(id))
    if (available.length === 0) continue
    const id = pick(rng, available)
    claimed.add(id)
    chosen.push(id)
  }
  if (chosen.length < 3) {
    throw new Error(`claimOneNodePerCluster: only ${chosen.length} clusters had an unclaimed node, need at least 3`)
  }
  return chosen
}

// ---- Edges --------------------------------------------------------------------------------

function buildHierarchyEdges(parentOf: Readonly<Record<string, string>>): MindmapEdge[] {
  return Object.keys(parentOf).map((childId, i) => ({
    id: `eh${i}`,
    fromId: parentOf[childId],
    toId: childId,
    kind: 'hierarchy',
  }))
}

function pickDistinctPair(rng: Rng, pool: readonly string[]): [string, string] {
  if (pool.length < 2) throw new Error('pickDistinctPair: pool needs at least 2 elements')
  const a = pick(rng, pool)
  let b = pick(rng, pool)
  let guard = 0
  while (b === a) {
    b = pick(rng, pool)
    guard += 1
    if (guard > 1000) throw new Error('pickDistinctPair: could not find a distinct second element after 1000 tries')
  }
  return [a, b]
}

/**
 * 400 link edges at full scale (4000 under `edgeStress`), split 30/30/40 straight/curve/
 * orthogonal, 20% labelled, and at least 10% with both endpoints drawn from the non-Node
 * pool so free-element edge anchoring is genuinely exercised rather than incidentally hit.
 */
function buildLinkEdges(
  allElementIds: readonly string[],
  nonNodeIds: readonly string[],
  elementCount: number,
  edgeStress: boolean,
  rng: Rng,
): MindmapEdge[] {
  const linkTotal = Math.max(0, scaleCount(edgeStress ? BASE_LINK_EDGE_STRESS_COUNT : BASE_LINK_EDGE_COUNT, elementCount))
  if (linkTotal === 0) return []

  const straightCount = Math.round(linkTotal * 0.3)
  const curveCount = Math.round(linkTotal * 0.3)
  const orthogonalCount = linkTotal - straightCount - curveCount
  const routings = shuffle(rng, [
    ...repeat<EdgeRouting>('straight', straightCount),
    ...repeat<EdgeRouting>('curve', curveCount),
    ...repeat<EdgeRouting>('orthogonal', orthogonalCount),
  ])

  const labelledCount = Math.round(linkTotal * 0.2)
  const labelledFlags = shuffle(rng, [
    ...repeat(true, labelledCount),
    ...repeat(false, Math.max(0, linkTotal - labelledCount)),
  ])

  const nonNodeTarget = Math.min(linkTotal, Math.round(linkTotal * 0.1))
  const canUseNonNodePool = nonNodeIds.length >= 2

  const edges: MindmapEdge[] = []
  for (let i = 0; i < linkTotal; i += 1) {
    const useNonNodePair = i < nonNodeTarget && canUseNonNodePool
    const [fromId, toId] = pickDistinctPair(rng, useNonNodePair ? nonNodeIds : allElementIds)
    edges.push({
      id: `el${i}`,
      fromId,
      toId,
      kind: 'link',
      routing: routings[i],
      label: labelledFlags[i] ? lorem(rng, nextInt(rng, 1, 3)) : undefined,
    })
  }
  return edges
}

// ---- Document assembly ---------------------------------------------------------------------
//
// The "draft": every element and edge, fully built, with placeholder (0, 0) positions. Both
// layouts consume the exact same Document; only `positionForest`/`positionDenseGrid` differ.

interface Document {
  readonly elementShells: readonly MindmapElement[]
  readonly edges: readonly MindmapEdge[]
  readonly clusterRoots: readonly string[]
  readonly parentOf: Readonly<Record<string, string>>
  readonly childrenOf: ReadonlyMap<string, readonly string[]>
  readonly sizeOf: ReadonlyMap<string, SizedNode>
  readonly shapeIds: readonly string[]
  readonly freeTextIds: readonly string[]
  readonly imageIds: readonly string[]
  readonly frameIds: readonly string[]
  /** Cluster-major element order, used to keep DENSE-GRID's board order stable and readable. */
  readonly singletonOrder: readonly string[]
  readonly framePlans: readonly FramePlan[]
  readonly treeLayout: TreeLayout
  readonly roles: FixtureRoles
}

function buildDocument(
  inventory: Inventory,
  clusterCount: number,
  elementCount: number,
  edgeStress: boolean,
  defeat: DeliberateConstruction | undefined,
  rng: Rng,
): Document {
  const clusters = buildClusters(inventory, clusterCount, rng)
  const free = buildFreeElements(inventory, rng, clusters.sizeOf)
  const treeLayout = layoutForestTrees(clusters.clusterRoots, clusters.childrenOf, clusters.sizeOf)

  const frameIds = Array.from({ length: inventory.frame }, (_, i) => `f${i}`)
  const tierPlan = computeFrameTierPlan(frameIds.length, elementCount)
  const { plans, roles } = planFrames({
    frameIds,
    tierPlan,
    elementCount,
    clusterCount,
    clusterRoots: clusters.clusterRoots,
    childrenOf: clusters.childrenOf,
    clusterOfNode: clusters.clusterOfNode,
    nodesByCluster: clusters.nodesByCluster,
    shapeIds: free.shapeIds,
    freeTextIds: free.freeTextIds,
    imageIds: free.imageIds,
    sizeOf: clusters.sizeOf,
    treeLayout,
    defeat,
    rng,
  })

  const sizeOf = clusters.sizeOf
  const frameShells: MindmapElement[] = plans.map((plan, index) => {
    sizeOf.set(plan.id, { width: plan.width, height: plan.height })
    return {
      id: plan.id,
      kind: 'frame',
      content: { kind: 'frame', title: `Frame ${index + 1}`, childIds: plan.childIds },
      x: 0,
      y: 0,
      width: plan.width,
      height: plan.height,
    }
  })

  const allElementShells = [...clusters.elementShells, ...free.shells, ...frameShells]
  const allElementIds = allElementShells.map((e) => e.id)
  const nonNodeIds = [...free.shapeIds, ...free.freeTextIds, ...free.imageIds, ...frameIds]

  const edges = [
    ...buildHierarchyEdges(clusters.parentOf),
    ...buildLinkEdges(allElementIds, nonNodeIds, elementCount, edgeStress, rng),
  ]

  const singletonOrder = [
    ...clusters.clusterRoots.flatMap((rootId) => flattenSubtree(rootId, clusters.childrenOf)),
    ...free.shapeIds,
    ...free.freeTextIds,
    ...free.imageIds,
  ]

  return {
    elementShells: allElementShells,
    edges,
    clusterRoots: clusters.clusterRoots,
    parentOf: clusters.parentOf,
    childrenOf: clusters.childrenOf,
    sizeOf,
    shapeIds: free.shapeIds,
    freeTextIds: free.freeTextIds,
    imageIds: free.imageIds,
    frameIds,
    singletonOrder,
    framePlans: plans,
    treeLayout,
    roles,
  }
}

// ---- FOREST positioning -------------------------------------------------------------------

/** Vertical gap between the tree grid and the band of frames that do not sit around tree nodes. */
const BAND_GAP = 600
const BAND_FRAME_GAP = 240
const SCATTER_ATTEMPTS = 64

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function rectsDisjoint(a: Rect, b: Rect): boolean {
  return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
}

function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/**
 * Tree nodes keep the exact positions the Balanced packer produced. Frames drawn around a
 * subtree take the rect the packer implies; every other frame goes into a band below the trees,
 * with its members and guests arranged inside it. Whatever free elements are left over scatter
 * across the whole area while avoiding every frame rect, so an element that ends up inside a
 * frame it does not belong to is one the generator put there on purpose.
 */
function positionForest(doc: Document, rng: Rng): Map<string, Point2> {
  const positions = new Map<string, Point2>(doc.treeLayout.positions)

  const bandPlans = doc.framePlans.filter((plan) => plan.placement === 'detached' || plan.forestAnchor === undefined)
  const bandIds = new Set(bandPlans.map((plan) => plan.id))
  for (const plan of doc.framePlans) {
    const anchor = plan.forestAnchor
    if (bandIds.has(plan.id) || anchor === undefined) continue
    positions.set(plan.id, anchor)
    for (const [id, offset] of plan.forestStripOffsets) {
      positions.set(id, { x: anchor.x + offset.x, y: anchor.y + offset.y })
    }
  }

  const treeBounds = doc.treeLayout.bounds
  const bandBoxes = bandPlans.map((plan) => ({ id: plan.id, width: plan.width, height: plan.height }))
  const bandPacked = shelfPack(bandBoxes, Math.max(treeBounds.maxX - treeBounds.minX, 1), BAND_FRAME_GAP)
  const bandOriginX = treeBounds.minX
  const bandOriginY = treeBounds.maxY + BAND_GAP

  for (const plan of bandPlans) {
    const slot = bandPacked.positions.get(plan.id)
    if (!slot) throw new Error(`positionForest: band packing produced no slot for frame "${plan.id}"`)
    const framePos = { x: bandOriginX + slot.x, y: bandOriginY + slot.y }
    positions.set(plan.id, framePos)
    if (plan.placement !== 'contain') continue
    for (const [id, offset] of plan.interiorOffsets) {
      positions.set(id, {
        x: framePos.x + FRAME_PADDING + offset.x,
        y: framePos.y + FRAME_PADDING + offset.y,
      })
    }
  }

  const frameRects = doc.framePlans.map((plan) => {
    const pos = positions.get(plan.id)
    if (!pos) throw new Error(`positionForest: frame "${plan.id}" was never placed`)
    return { x: pos.x, y: pos.y, width: plan.width, height: plan.height }
  })

  const area = {
    minX: treeBounds.minX - CLUSTER_GUTTER,
    minY: treeBounds.minY - CLUSTER_GUTTER,
    maxX: treeBounds.maxX + CLUSTER_GUTTER,
    maxY: bandOriginY + bandPacked.height + CLUSTER_GUTTER,
  }

  const scatterIds = [...doc.shapeIds, ...doc.freeTextIds, ...doc.imageIds].filter((id) => !positions.has(id))
  for (const id of scatterIds) {
    const size = doc.sizeOf.get(id)
    if (!size) throw new Error(`positionForest: no size registered for free element "${id}"`)
    let placed = false
    for (let attempt = 0; attempt < SCATTER_ATTEMPTS && !placed; attempt += 1) {
      const candidate = {
        x: nextFloat(rng, area.minX, area.maxX - size.width),
        y: nextFloat(rng, area.minY, area.maxY - size.height),
      }
      const box = { ...candidate, width: size.width, height: size.height }
      if (frameRects.every((rect) => rectsDisjoint(box, rect))) {
        positions.set(id, candidate)
        placed = true
      }
    }
    if (!placed) {
      throw new Error(
        `positionForest: could not scatter "${id}" clear of every frame in ${SCATTER_ATTEMPTS} tries; ` +
          'frames now cover too much of the canvas for the orphan guarantee to stay deliberate',
      )
    }
  }

  return positions
}

// ---- DENSE-GRID positioning ----------------------------------------------------------------

const BOARD_CELL_WIDTH = 168
const BOARD_CELL_HEIGHT = 44

/**
 * Packs the whole document onto a board with no two rects overlapping (a frame and its own
 * members excepted, which is what containment means). A frame that contains its members travels
 * as one block, so the board keeps the document's grouping instead of shredding it.
 *
 * The board's aspect is aimed at the viewport, because the property this layout exists for is
 * that the entire document fits on screen at a zoom above the camera's 0.1 floor: a board with
 * the wrong aspect ratio fails that even when its area would allow it.
 */
function positionDenseGrid(doc: Document): Map<string, Point2> {
  const insideFrame = new Set<string>()
  for (const plan of doc.framePlans) {
    if (plan.placement !== 'contain') continue
    for (const id of plan.interiorOffsets.keys()) insideFrame.add(id)
  }

  const singletons = doc.singletonOrder.filter((id) => !insideFrame.has(id))
  const frameBlocks = doc.framePlans.map((plan) => ({ id: plan.id, width: plan.width, height: plan.height }))

  // Frames are spread through the board rather than appended, so the large boxes do not end up
  // as one slab in the last rows where they would dominate whatever the board is measuring.
  const blocks: PackItem[] = []
  const stride = frameBlocks.length > 0 ? Math.max(1, Math.floor(singletons.length / frameBlocks.length)) : 0
  let frameCursor = 0
  singletons.forEach((id, index) => {
    if (stride > 0 && index % stride === 0 && frameCursor < frameBlocks.length) {
      blocks.push(frameBlocks[frameCursor])
      frameCursor += 1
    }
    const size = doc.sizeOf.get(id)
    if (!size) throw new Error(`positionDenseGrid: no size registered for "${id}"`)
    blocks.push({ id, width: size.width, height: size.height })
  })
  while (frameCursor < frameBlocks.length) {
    blocks.push(frameBlocks[frameCursor])
    frameCursor += 1
  }

  const columns = columnsForAspect(
    blocks,
    BOARD_CELL_WIDTH,
    BOARD_CELL_HEIGHT,
    SPIKE_VIEWPORT_WIDTH / SPIKE_VIEWPORT_HEIGHT,
  )
  const packed = packCells(blocks, { cellWidth: BOARD_CELL_WIDTH, cellHeight: BOARD_CELL_HEIGHT, columns })

  const positions = new Map<string, Point2>()
  for (const [id, pos] of packed.positions) positions.set(id, pos)

  for (const plan of doc.framePlans) {
    if (plan.placement !== 'contain') continue
    const framePos = positions.get(plan.id)
    if (!framePos) throw new Error(`positionDenseGrid: frame "${plan.id}" was never packed`)
    for (const [id, offset] of plan.interiorOffsets) {
      positions.set(id, {
        x: framePos.x + FRAME_PADDING + offset.x,
        y: framePos.y + FRAME_PADDING + offset.y,
      })
    }
  }

  return positions
}

// ---- Structural assertions ------------------------------------------------------------------
//
// Verified against the *finished* fixture (final positions, final membership), independent of
// how it was built, so a construction bug shows up as a thrown error here rather than as a
// silently wrong measurement downstream. Every property is asserted on the frames designated to
// carry it, by id, and only then as a global count: a global count alone is satisfied by
// accident by frames nobody constructed for the purpose, which makes it prove nothing.

function findClusterRoot(id: string, parentOf: Readonly<Record<string, string>>): string {
  let current = id
  const guard = new Set<string>()
  while (parentOf[current] !== undefined) {
    if (guard.has(current)) throw new Error(`findClusterRoot: cycle detected in parentOf at "${current}"`)
    guard.add(current)
    current = parentOf[current]
  }
  return current
}

function isFrameElement(e: MindmapElement): e is MindmapElement & { content: FrameContent } {
  return e.content.kind === 'frame'
}

function assertInventoryCounts(elements: readonly MindmapElement[], expected: Inventory): void {
  const counts = {
    nodeText: 0, nodeTask: 0, nodeCode: 0, nodeLink: 0, nodeRef: 0, nodeMath: 0,
    shape: 0, freeText: 0, image: 0, frame: 0,
  }
  for (const el of elements) {
    if (el.kind === 'node') {
      const contentKind = el.content.kind
      if (contentKind === 'text') counts.nodeText += 1
      else if (contentKind === 'task') counts.nodeTask += 1
      else if (contentKind === 'code') counts.nodeCode += 1
      else if (contentKind === 'link') counts.nodeLink += 1
      else if (contentKind === 'note' || contentKind === 'flashcard') counts.nodeRef += 1
      else if (contentKind === 'math') counts.nodeMath += 1
      else throw new Error(`assertInventoryCounts: unexpected node content kind "${contentKind}"`)
    } else if (el.kind === 'shape') counts.shape += 1
    else if (el.kind === 'text') counts.freeText += 1
    else if (el.kind === 'image') counts.image += 1
    else if (el.kind === 'frame') counts.frame += 1
  }

  const keys = Object.keys(expected) as (keyof Inventory)[]
  const mismatches = keys.filter((k) => counts[k] !== expected[k])
  if (mismatches.length > 0) {
    throw new Error(
      `assertInventoryCounts: mismatch in ${mismatches.join(', ')}, expected ${JSON.stringify(expected)}, got ${JSON.stringify(counts)}`,
    )
  }
}

function assertMembershipIntegrity(elements: readonly MindmapElement[]): Set<string> {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const claimed = new Set<string>()
  for (const frame of elements.filter(isFrameElement)) {
    for (const memberId of frame.content.childIds) {
      if (claimed.has(memberId)) {
        throw new Error(`assertMembershipIntegrity: element "${memberId}" belongs to more than one frame`)
      }
      claimed.add(memberId)
      const member = byId.get(memberId)
      if (!member) throw new Error(`assertMembershipIntegrity: frame "${frame.id}" references unknown member "${memberId}"`)
      if (member.kind === 'frame') {
        throw new Error(`assertMembershipIntegrity: frame "${frame.id}" contains another frame ("${memberId}")`)
      }
    }
  }
  return claimed
}

/**
 * S7 drags a 120-member frame and measures what that costs. If the members are scattered over
 * the whole canvas, almost all of them are off screen, the arm repaints a handful of nodes and
 * the number that comes back is not a group drag at all, so this asserts they are visible
 * together at S7's own zoom.
 */
function assertGroupDragLocality(
  elements: readonly MindmapElement[],
  groupDragFrameIds: readonly string[],
): void {
  if (groupDragFrameIds.length === 0) return
  const byId = new Map(elements.map((e) => [e.id, e]))
  const windowWidth = SPIKE_VIEWPORT_WIDTH / GROUP_DRAG_ZOOM
  const windowHeight = SPIKE_VIEWPORT_HEIGHT / GROUP_DRAG_ZOOM

  for (const frameId of groupDragFrameIds) {
    const frame = byId.get(frameId)
    if (!frame || !isFrameElement(frame)) throw new Error(`assertGroupDragLocality: "${frameId}" is not a frame`)

    const view: Rect = {
      x: frame.x + frame.width / 2 - windowWidth / 2,
      y: frame.y + frame.height / 2 - windowHeight / 2,
      width: windowWidth,
      height: windowHeight,
    }
    if (!rectContains(view, frame)) {
      throw new Error(
        `assertGroupDragLocality: frame "${frameId}" is ${frame.width}x${frame.height}, larger than S7's ` +
          `${windowWidth}x${windowHeight} canvas window, so the drag target itself cannot be fully on screen`,
      )
    }

    const members = frame.content.childIds.map((id) => byId.get(id)).filter((m): m is MindmapElement => m !== undefined)
    const visible = members.filter((m) => rectContains(view, m)).length
    const required = Math.ceil(members.length * GROUP_DRAG_VISIBLE_FRACTION)
    if (visible < required) {
      throw new Error(
        `assertGroupDragLocality: only ${visible} of ${members.length} members of "${frameId}" fit S7's viewport ` +
          `at zoom ${GROUP_DRAG_ZOOM}, need ${required}; the group drag would measure off-screen store churn`,
      )
    }
  }
}

function assertFrameContainment(elements: readonly MindmapElement[], roles: FixtureRoles): void {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const frames = elements.filter(isFrameElement)
  const containing = new Set(roles.containingFrameIds)

  for (const frameId of roles.containingFrameIds) {
    const frame = byId.get(frameId)
    if (!frame || !isFrameElement(frame)) throw new Error(`assertFrameContainment: "${frameId}" is not a frame`)
    for (const memberId of frame.content.childIds) {
      const member = byId.get(memberId)
      if (!member) throw new Error(`assertFrameContainment: frame "${frameId}" references unknown member "${memberId}"`)
      if (!rectContains(frame, member)) {
        throw new Error(
          `assertFrameContainment: frame "${frameId}" does not enclose its member "${memberId}" ` +
            `(frame ${frame.x},${frame.y} ${frame.width}x${frame.height}; member ${member.x},${member.y} ${member.width}x${member.height})`,
        )
      }
    }
  }

  for (const frameId of roles.detachedFrameIds) {
    const frame = byId.get(frameId)
    if (!frame || !isFrameElement(frame)) throw new Error(`assertFrameContainment: "${frameId}" is not a frame`)
    for (const memberId of frame.content.childIds) {
      const member = byId.get(memberId)
      if (member && !rectsDisjoint(frame, member)) {
        throw new Error(
          `assertFrameContainment: frame "${frameId}" is designated as placed away from its members, ` +
            `but member "${memberId}" overlaps its rect`,
        )
      }
    }
  }

  const enclosingCount = frames.filter((frame) => {
    const members = frame.content.childIds.map((id) => byId.get(id)).filter((m): m is MindmapElement => m !== undefined)
    return members.length > 0 && members.every((m) => rectContains(frame, m))
  }).length
  if (enclosingCount !== containing.size) {
    throw new Error(
      `assertFrameContainment: ${enclosingCount} frames enclose every member, expected exactly the ` +
        `${containing.size} designated to; a frame is enclosing its members by accident or failing to`,
    )
  }
  if (frames.length > 0 && enclosingCount * 2 <= frames.length) {
    throw new Error(
      `assertFrameContainment: only ${enclosingCount} of ${frames.length} frames enclose their members; ` +
        'the fixture is modelling the pathological frame as the normal case',
    )
  }
}

function assertStructuralRoles(
  elements: readonly MindmapElement[],
  parentOf: Readonly<Record<string, string>>,
  roles: FixtureRoles,
  elementCount: number,
): void {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const frames = elements.filter(isFrameElement)
  const frameById = new Map(frames.map((f) => [f.id, f]))
  const membersOf = (frameId: string): MindmapElement[] => {
    const frame = frameById.get(frameId)
    if (!frame) throw new Error(`assertStructuralRoles: "${frameId}" is not a frame`)
    return frame.content.childIds.map((id) => byId.get(id)).filter((m): m is MindmapElement => m !== undefined)
  }

  for (const frameId of roles.crossClusterFrameIds) {
    const members = membersOf(frameId)
    const nonNodes = members.filter((m) => m.kind !== 'node')
    if (nonNodes.length > 0) {
      throw new Error(
        `assertStructuralRoles: cross-cluster frame "${frameId}" owns ${nonNodes.length} non-node members, ` +
          'so its cluster span is not the deliberate one-node-per-cluster construction',
      )
    }
    const clusters = new Set(members.map((m) => findClusterRoot(m.id, parentOf)))
    if (clusters.size < 3 || clusters.size !== members.length) {
      throw new Error(
        `assertStructuralRoles: cross-cluster frame "${frameId}" has ${members.length} members in ` +
          `${clusters.size} clusters, expected one member per cluster across at least 3`,
      )
    }
  }

  const requiredMixedKinds: readonly ElementKind[] = ['node', 'shape', 'text', 'image']
  for (const frameId of roles.mixedKindFrameIds) {
    const kinds = new Set(membersOf(frameId).map((m) => m.kind))
    const missing = requiredMixedKinds.filter((k) => !kinds.has(k))
    if (missing.length > 0) {
      throw new Error(`assertStructuralRoles: mixed-kind frame "${frameId}" has no member of kind ${missing.join(', ')}`)
    }
  }

  for (const frameId of roles.outsideRectFrameIds) {
    const frame = frameById.get(frameId)
    if (!frame) throw new Error(`assertStructuralRoles: "${frameId}" is not a frame`)
    const members = membersOf(frameId)
    if (members.length === 0) {
      throw new Error(`assertStructuralRoles: outside-rect frame "${frameId}" has no members`)
    }
    const inside = members.filter((m) => !rectsDisjoint(frame, m))
    if (inside.length > 0) {
      throw new Error(
        `assertStructuralRoles: outside-rect frame "${frameId}" has ${inside.length} members touching its own rect`,
      )
    }
  }

  const minCrossCluster = scaleCount(BASE_STRUCTURAL_MIN.crossCluster, elementCount)
  const minOutsideRect = scaleCount(BASE_STRUCTURAL_MIN.outsideRect, elementCount)
  const minMixedKind = scaleCount(BASE_STRUCTURAL_MIN.mixedKind, elementCount)
  if (roles.crossClusterFrameIds.length < Math.min(minCrossCluster, frames.length)) {
    throw new Error(`assertStructuralRoles: ${roles.crossClusterFrameIds.length} cross-cluster frames, need ${minCrossCluster}`)
  }
  if (roles.outsideRectFrameIds.length < Math.min(minOutsideRect, frames.length)) {
    throw new Error(`assertStructuralRoles: ${roles.outsideRectFrameIds.length} outside-rect frames, need ${minOutsideRect}`)
  }
  if (roles.mixedKindFrameIds.length < Math.min(minMixedKind, frames.length)) {
    throw new Error(`assertStructuralRoles: ${roles.mixedKindFrameIds.length} mixed-kind frames, need ${minMixedKind}`)
  }
}

/**
 * An element sits inside a frame's rect while belonging to no frame. Asserted as an exact set,
 * not a minimum: the whole point of the property is that the product must handle geometric
 * containment that means nothing, and a count inflated by elements that landed there by luck
 * would let the deliberate construction rot away unnoticed.
 */
function assertOrphans(
  elements: readonly MindmapElement[],
  claimed: ReadonlySet<string>,
  roles: FixtureRoles,
  elementCount: number,
): void {
  const frames = elements.filter(isFrameElement)
  const observed = elements
    .filter((e) => e.kind !== 'frame' && !claimed.has(e.id) && frames.some((f) => rectContains(f, e)))
    .map((e) => e.id)
    .sort()
  const expected = [...roles.orphanElementIds].sort()

  const minOrphan = scaleCount(BASE_STRUCTURAL_MIN.orphan, elementCount)
  if (expected.length < minOrphan) {
    throw new Error(`assertOrphans: ${expected.length} elements were placed inside a frame they do not belong to, need ${minOrphan}`)
  }
  if (observed.join(',') !== expected.join(',')) {
    throw new Error(
      `assertOrphans: elements inside a frame without belonging to it are [${observed.join(', ')}], ` +
        `expected exactly the designated [${expected.join(', ')}]`,
    )
  }
}

/**
 * No two boxes on the DENSE-GRID board overlap, except a frame and the members it encloses.
 * "A hand-placed board" means a human could have arranged it; a slab of boxes stacked on each
 * other is an overdraw hotspot that is a packing artifact, and it would skew every measurement
 * taken on this layout toward whichever arm handles heavy local overdraw best.
 */
function assertNoOverlap(elements: readonly MindmapElement[], plans: readonly FramePlan[]): void {
  const enclosedBy = new Map<string, string>()
  for (const plan of plans) {
    if (plan.placement !== 'contain') continue
    for (const id of plan.interiorOffsets.keys()) enclosedBy.set(id, plan.id)
  }

  const ordered = [...elements].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))
  const active: MindmapElement[] = []
  for (const element of ordered) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].x + active[i].width <= element.x) {
        active.splice(i, 1)
        continue
      }
      const other = active[i]
      if (enclosedBy.get(element.id) === other.id || enclosedBy.get(other.id) === element.id) continue
      if (!rectsDisjoint(element, other)) {
        throw new Error(
          `assertNoOverlap: "${element.id}" (${element.x},${element.y} ${element.width}x${element.height}) overlaps ` +
            `"${other.id}" (${other.x},${other.y} ${other.width}x${other.height})`,
        )
      }
    }
    active.push(element)
  }
}

function assertFitsAboveZoomFloor(bounds: Bounds): void {
  const { zoom, clampedToFloor } = fitZoom(bounds, SPIKE_VIEWPORT_WIDTH, SPIKE_VIEWPORT_HEIGHT)
  if (clampedToFloor || zoom <= MIN_SCALE) {
    throw new Error(
      `assertFitsAboveZoomFloor: dense-grid fit zoom ${zoom} does not clear the camera's floor ${MIN_SCALE}; ` +
        `bounds ${JSON.stringify(bounds)} would let viewport culling dodge the measurement instead of being inert`,
    )
  }
}

// ---- Digest ---------------------------------------------------------------------------------

function serializeContent(content: ElementContent): string {
  switch (content.kind) {
    case 'text':
      return `text|${content.text}`
    case 'task':
      return `task|${content.text}|${content.done}`
    case 'code':
      return `code|${content.language}|${content.source}`
    case 'math':
      return `math|${content.latex}`
    case 'link':
      return `link|${content.url}|${content.title}`
    case 'note':
    case 'flashcard':
      return `${content.kind}|${content.targetId}|${content.title}|${content.badge ?? ''}|${content.missing ?? ''}`
    case 'shape':
      return `shape|${content.shape}|${content.text ?? ''}`
    case 'freeText':
      return `freeText|${content.text}`
    case 'image':
      return `image|${content.assetId}`
    case 'frame':
      return `frame|${content.title}|${content.childIds.join(',')}`
  }
}

function toDigestDocument(
  elements: readonly MindmapElement[],
  edges: readonly MindmapEdge[],
  clusterRoots: readonly string[],
  parentOf: Readonly<Record<string, string>>,
): DigestDocument {
  return {
    elements: elements.map((e) => ({
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      pinned: e.pinned,
      collapsed: e.collapsed,
      fill: e.fill,
      stroke: e.stroke,
      contentDigestField: serializeContent(e.content),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      kind: e.kind,
      label: e.label,
      routing: e.routing,
      lineStyle: e.lineStyle,
      thickness: e.thickness,
      color: e.color,
      startCap: e.startCap,
      endCap: e.endCap,
    })),
    clusterRoots,
    parentOf,
  }
}

/**
 * The document's digest with position left out: proves FOREST and DENSE-GRID are the same
 * logical document (same ids, kinds, sizes, content, edges, membership) differing only in where
 * things are placed, which is the entire point of building one document and positioning it
 * twice rather than generating two unrelated fixtures.
 */
export function logicalDigest(fixture: MindmapFixture): string {
  return computeContentDigest(toDigestDocument(fixture.elements, fixture.edges, fixture.clusterRoots, fixture.parentOf))
}

// ---- Public API -------------------------------------------------------------------------

export interface GenerateFixtureArgs {
  readonly layout: FixtureLayout
  readonly elementCount: number
  readonly seed: number
  /** Swaps the 400 link edges for 4000: a non-gating headroom read, never part of a verdict. */
  readonly edgeStress?: boolean
  /**
   * Replaces one deliberate construction with the naive draw it stands in for. Exists so the
   * suite can prove each structural assertion actually fails without it, rather than passing on
   * a property the fixture would have had anyway.
   */
  readonly defeat?: DeliberateConstruction
}

export interface GeneratedFixture {
  readonly fixture: MindmapFixture
  /** Which frame plays which structural role, so scenarios and assertions name ids, not counts. */
  readonly roles: FixtureRoles
}

export function generateFixtureWithRoles(args: GenerateFixtureArgs): GeneratedFixture {
  const { layout, elementCount, seed, edgeStress = false, defeat } = args
  const rng = mulberry32(seed)

  const inventory = computeInventory(elementCount)
  if (inventoryTotal(inventory) !== elementCount) {
    // Guards the scaling arithmetic itself: this should be unreachable by construction, so
    // if it ever fires, computeInventory's rounding/reconciliation has a bug.
    throw new Error(`generateFixture: inventory totals ${inventoryTotal(inventory)}, expected ${elementCount}`)
  }

  const clusterCount = computeClusterCount(elementCount)
  const doc = buildDocument(inventory, clusterCount, elementCount, edgeStress, defeat, rng)

  const positions = layout === 'forest' ? positionForest(doc, rng) : positionDenseGrid(doc)

  const finalElements = doc.elementShells.map((shell) => {
    const pos = positions.get(shell.id)
    if (!pos) throw new Error(`generateFixture: no position computed for element "${shell.id}"`)
    return { ...shell, x: pos.x, y: pos.y }
  })

  assertInventoryCounts(finalElements, inventory)
  const claimed = assertMembershipIntegrity(finalElements)
  assertGroupDragLocality(finalElements, doc.roles.groupDragFrameIds)
  assertFrameContainment(finalElements, doc.roles)
  assertStructuralRoles(finalElements, doc.parentOf, doc.roles, elementCount)
  assertOrphans(finalElements, claimed, doc.roles, elementCount)

  const bounds = boundsOf(finalElements)
  if (layout === 'dense-grid') {
    assertNoOverlap(finalElements, doc.framePlans)
    assertFitsAboveZoomFloor(bounds)
  }

  const digest = computeDigest(toDigestDocument(finalElements, doc.edges, doc.clusterRoots, doc.parentOf))

  return {
    fixture: {
      id: `mindmap-spike-${layout}-${elementCount}-${seed}${edgeStress ? '-edgestress' : ''}`,
      layout,
      elements: finalElements,
      edges: doc.edges,
      clusterRoots: doc.clusterRoots,
      parentOf: doc.parentOf,
      bounds,
      digest,
    },
    roles: doc.roles,
  }
}

export function generateFixture(args: GenerateFixtureArgs): MindmapFixture {
  return generateFixtureWithRoles(args).fixture
}

/**
 * Recomputes a position for every tree node (cluster roots included) by reshuffling each
 * parent's sibling order and rerunning the same Balanced packer, so the result is a genuinely
 * different arrangement rather than a no-op, since a relayout that happens to reproduce the
 * original positions would understate S9's real cost. Each cluster's root keeps its current
 * position (mirroring `Finalize`'s real anchoring behaviour on a live document); only the
 * shape hanging off each root changes.
 */
export function computeRelayout(fixture: MindmapFixture, seed: number): ReadonlyMap<string, Point> {
  const rng = mulberry32(seed)
  const byId = new Map(fixture.elements.map((e) => [e.id, e]))

  const sizeOf = new Map<string, SizedNode>()
  for (const el of fixture.elements) {
    if (el.kind === 'node') sizeOf.set(el.id, { width: el.width, height: el.height })
  }

  const childrenOf = new Map<string, string[]>()
  for (const el of fixture.elements) {
    const parent = fixture.parentOf[el.id]
    if (parent === undefined) continue
    const kids = childrenOf.get(parent) ?? []
    kids.push(el.id)
    childrenOf.set(parent, kids)
  }
  for (const [parent, kids] of childrenOf) childrenOf.set(parent, shuffle(rng, kids))

  const result = new Map<string, Point>()
  for (const rootId of fixture.clusterRoots) {
    const rootElement = byId.get(rootId)
    if (!rootElement) throw new Error(`computeRelayout: cluster root "${rootId}" not found in fixture elements`)

    const local = balancedLayout(rootId, childrenOf, sizeOf, TREE_NODE_SPACING, TREE_RANK_SPACING)
    const localRoot = local.get(rootId)
    if (!localRoot) throw new Error(`computeRelayout: balanced layout produced no position for root "${rootId}"`)

    translateAll(local, rootElement.x - localRoot.x, rootElement.y - localRoot.y)
    for (const [id, pos] of local) result.set(id, pos)
  }

  const expectedCount = fixture.clusterRoots.length + Object.keys(fixture.parentOf).length
  if (result.size !== expectedCount) {
    throw new Error(`computeRelayout: expected positions for ${expectedCount} tree nodes, computed ${result.size}`)
  }

  return result
}
