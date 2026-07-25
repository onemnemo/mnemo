/**
 * A faithful reimplementation of the shipped desktop's `BalancedLayoutProvider` (see
 * `Mnemo.Infrastructure/Services/Mindmap/Layout/MindmapLayoutMath.cs` and
 * `MindmapLayoutProviders.cs`, the `Layered` method and `BalancedLayoutProvider.Compute`).
 * The FOREST fixture's realism depends on this matching the real algorithm, not an
 * approximation of it, so every step below mirrors the C# line for line.
 *
 * Reimplemented rather than imported because the real algorithm lives in the C# host and this
 * generator runs in the browser/vitest, with no IPC bridge in the spike harness. A divergence
 * here would silently change the shape of the FOREST fixture without changing its digest
 * inputs in an obviously wrong way, so tests pin known geometry to catch drift.
 */

export interface SizedNode {
  readonly width: number
  readonly height: number
}

export interface Point2 {
  readonly x: number
  readonly y: number
}

/** Children of a node in sibling order. Absence means "no children" (a leaf). */
export type ChildrenOf = ReadonlyMap<string, readonly string[]>

/**
 * Layered tidy-tree packing (`MindmapLayoutMath.Layered`). `horizontal` flows depth along X
 * (root left, matching Balanced's per-side layout) and packs siblings along Y.
 */
export function layered(
  rootId: string,
  childrenOf: ChildrenOf,
  sizeOf: ReadonlyMap<string, SizedNode>,
  horizontal: boolean,
  nodeSpacing: number,
  rankSpacing: number,
): Map<string, Point2> {
  const sizeOfOrThrow = (id: string): SizedNode => {
    const size = sizeOf.get(id)
    if (!size) throw new Error(`layered: no size registered for node "${id}"`)
    return size
  }
  const mainExtent = (id: string): number => (horizontal ? sizeOfOrThrow(id).width : sizeOfOrThrow(id).height)
  const crossExtent = (id: string): number => (horizontal ? sizeOfOrThrow(id).height : sizeOfOrThrow(id).width)
  const kidsOf = (id: string): readonly string[] => childrenOf.get(id) ?? []

  const depth = new Map<string, number>()
  const maxMainAtDepth = new Map<number, number>()

  const visitDepths = (id: string, d: number): void => {
    depth.set(id, d)
    maxMainAtDepth.set(d, Math.max(maxMainAtDepth.get(d) ?? 0, mainExtent(id)))
    for (const child of kidsOf(id)) visitDepths(child, d + 1)
  }
  visitDepths(rootId, 0)

  // Center of each depth band along the main axis: ranks are size-aware and centered.
  const mainCenter = new Map<number, number>()
  let acc = 0
  for (let d = 0; maxMainAtDepth.has(d); d += 1) {
    const bandExtent = maxMainAtDepth.get(d) as number
    mainCenter.set(d, acc + bandExtent / 2)
    acc += bandExtent + rankSpacing
  }

  // Cross packing: leaves take sequential slots, a parent centers on its children's span.
  const cross = new Map<string, number>()
  let cursor = 0

  const pack = (id: string): void => {
    const kids = kidsOf(id)
    if (kids.length === 0) {
      cross.set(id, cursor + crossExtent(id) / 2)
      cursor += crossExtent(id) + nodeSpacing
      return
    }
    for (const kid of kids) pack(kid)
    const first = cross.get(kids[0]) as number
    const last = cross.get(kids[kids.length - 1]) as number
    cross.set(id, (first + last) / 2)
  }
  pack(rootId)

  const positions = new Map<string, Point2>()
  const emit = (id: string): void => {
    const mc = mainCenter.get(depth.get(id) as number) as number
    const cc = cross.get(id) as number
    const size = sizeOfOrThrow(id)
    positions.set(
      id,
      horizontal ? { x: mc - size.width / 2, y: cc - size.height / 2 } : { x: cc - size.width / 2, y: mc - size.height / 2 },
    )
    for (const child of kidsOf(id)) emit(child)
  }
  emit(rootId)
  return positions
}

/** Translate every position by a fixed delta, in place. */
export function translateAll(positions: Map<string, Point2>, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return
  for (const [id, p] of positions) positions.set(id, { x: p.x + dx, y: p.y + dy })
}

/**
 * `BalancedLayoutProvider.Compute`: split the root's children alternately into right/left,
 * lay each side out with `layered` (horizontal, root-left), then mirror the left side across
 * the root's vertical center line. Both sides share the same `childrenOf` below the root, so
 * only the *direct* children of `rootId` are actually split; deeper structure is untouched.
 *
 * Positions come back anchored with the root at (0, 0) rather than at a stored X/Y, since the
 * fixture generator (unlike the live document Balanced normally runs against) has no prior
 * root position to preserve, so callers translate the whole cluster to wherever it belongs.
 */
export function balancedLayout(
  rootId: string,
  childrenOf: ChildrenOf,
  sizeOf: ReadonlyMap<string, SizedNode>,
  nodeSpacing: number,
  rankSpacing: number,
): Map<string, Point2> {
  const rootSize = sizeOf.get(rootId)
  if (!rootSize) throw new Error(`balancedLayout: no size registered for root "${rootId}"`)

  const rootKids = childrenOf.get(rootId) ?? []
  if (rootKids.length === 0) {
    return new Map([[rootId, { x: 0, y: 0 }]])
  }

  const right: string[] = []
  const left: string[] = []
  rootKids.forEach((id, i) => (i % 2 === 0 ? right : left).push(id))

  const sideLayout = (sideKids: readonly string[]): Map<string, Point2> => {
    const overridden = new Map(childrenOf)
    overridden.set(rootId, sideKids)
    return layered(rootId, overridden, sizeOf, true, nodeSpacing, rankSpacing)
  }

  const rightPositions = sideLayout(right)
  const leftPositions = sideLayout(left)

  const rRoot = rightPositions.get(rootId) as Point2
  const lRoot = leftPositions.get(rootId) as Point2
  translateAll(leftPositions, rRoot.x - lRoot.x, rRoot.y - lRoot.y)

  const axis = rRoot.x + rootSize.width / 2
  const merged = new Map(rightPositions)
  for (const [id, pos] of leftPositions) {
    if (id === rootId) continue
    const size = sizeOf.get(id)
    if (!size) throw new Error(`balancedLayout: no size registered for node "${id}"`)
    merged.set(id, { x: 2 * axis - pos.x - size.width, y: pos.y })
  }
  return merged
}

/** Axis-aligned bounding box of a set of positioned, sized nodes. */
export function boundsOfPositions(positions: ReadonlyMap<string, Point2>, sizeOf: ReadonlyMap<string, SizedNode>) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [id, p] of positions) {
    const size = sizeOf.get(id)
    if (!size) throw new Error(`boundsOfPositions: no size registered for node "${id}"`)
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + size.width)
    maxY = Math.max(maxY, p.y + size.height)
  }
  return { minX, minY, maxX, maxY }
}
