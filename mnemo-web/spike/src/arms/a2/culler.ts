/**
 * Viewport culling over a uniform grid, for anything with canvas-space bounds.
 *
 * A1 measured culling as nearly worthless: cutting the DOM by 99% bought 2x, because React
 * Flow's cost was JavaScript over the node array and that array stayed the same size. A2 has no
 * such per-frame JavaScript, and it turned out to have inherited the same shape of problem one
 * level down: with five thousand boxes under a transformed ancestor, the engine's own paint and
 * property walk is proportional to how many boxes exist, and a pan showing ONE element still
 * cost fifty milliseconds a frame. Culling is what turns "how many exist" into "how many are
 * visible", which is the cost model the product actually needs, and unlike in A1 it is the
 * whole fix rather than a factor of two.
 *
 * Two things make this cheap enough to run on every frame.
 *
 * **Work is proportional to the cells crossed, not to the targets.** The visible rectangle is
 * resolved to a range of grid cells; when the range has not changed, which is most frames of a
 * slow pan, the update does nothing at all. Only cells entering or leaving contribute anything
 * to toggle.
 *
 * **Targets are hidden, not unmounted.** React owns these nodes, and detaching a node React
 * still believes it parents turns unmounting into a crash. `display: none` skips layout, paint
 * and compositing for the subtree, which is the whole of what culling has to buy. It does mean
 * the DOM node count stays constant by construction, so A2's recorded `domNodes` is not
 * comparable with an arm that unmounts, and must be read as "how many exist" rather than "how
 * many are drawn".
 */

import type { Viewport } from '../../harness/contract'

/**
 * Canvas units per grid cell. Large enough that a typical view spans a handful of cells, so a
 * pan crosses a boundary rarely; small enough that one cell entering does not drag in a
 * meaningful fraction of the document.
 */
const CELL_SIZE = 1024

/** Extra ring of cells kept mounted around the view, so content exists before it is needed. */
const MARGIN_CELLS = 1

export interface CullBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CullTarget {
  readonly key: string
  /** Live bounds, so re-indexing after a relayout places the target where it is now. */
  bounds(): CullBounds | undefined
  /**
   * Every DOM node this target owns. An edge owns its path and, when it has one, its label.
   * Typed by the style property rather than as HTMLElement because an edge's path is SVG.
   */
  readonly nodes: readonly ElementCSSInlineStyle[]
}

interface CellRange {
  readonly cx0: number
  readonly cy0: number
  readonly cx1: number
  readonly cy1: number
}

export interface Culler {
  /** Recomputes visibility for a camera. A no-op when the visible cell range has not moved. */
  update(viewport: Viewport, viewWidth: number, viewHeight: number): void
  /**
   * Re-indexes from current bounds. A relayout moves every element, which invalidates the grid
   * wholesale; without this the culler would keep answering from where things used to be, and
   * content would stay hidden in the middle of the view.
   */
  rebuild(): void
  /** Keeps these targets rendered for the duration of a gesture, wherever they end up. */
  pin(keys: readonly string[]): void
  unpinAll(): void
  setEnabled(enabled: boolean): void
  isEnabled(): boolean
  /** Targets currently rendered, so a culling dodge is visible rather than implied. */
  renderedCount(): number
}

function keyOf(cx: number, cy: number): string {
  return `${cx},${cy}`
}

export function createCuller(targets: readonly CullTarget[], enabled: boolean): Culler {
  const byKey = new Map<string, CullTarget>()
  for (const target of targets) byKey.set(target.key, target)

  const cells = new Map<string, string[]>()

  const index = (): void => {
    cells.clear()
    for (const target of targets) {
      const bounds = target.bounds()
      if (!bounds) continue
      // Registered in every cell it overlaps rather than only the one holding its origin: a
      // frame is far larger than a cell and an edge can be longer still, and content that
      // vanished whenever its top-left corner left the view would be a visible bug rather than
      // an optimization.
      const cx0 = Math.floor(bounds.x / CELL_SIZE)
      const cy0 = Math.floor(bounds.y / CELL_SIZE)
      const cx1 = Math.floor((bounds.x + bounds.width) / CELL_SIZE)
      const cy1 = Math.floor((bounds.y + bounds.height) / CELL_SIZE)
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const cell = keyOf(cx, cy)
          const bucket = cells.get(cell)
          if (bucket) bucket.push(target.key)
          else cells.set(cell, [target.key])
        }
      }
    }
  }

  // Reference counted because a target registered in several cells would otherwise be hidden by
  // the first of them to leave the view while it is still inside another.
  const refs = new Map<string, number>()
  let rendered = 0
  let isEnabled = enabled
  let range: CellRange | null = null
  let pinned: readonly string[] = []

  const setDisplay = (key: string, value: string): void => {
    const target = byKey.get(key)
    if (!target) return
    for (const node of target.nodes) node.style.display = value
  }

  const retain = (key: string): void => {
    const next = (refs.get(key) ?? 0) + 1
    refs.set(key, next)
    if (next === 1) {
      setDisplay(key, '')
      rendered += 1
    }
  }

  const release = (key: string): void => {
    const current = refs.get(key) ?? 0
    if (current === 0) return
    if (current === 1) {
      refs.delete(key)
      setDisplay(key, 'none')
      rendered -= 1
      return
    }
    refs.set(key, current - 1)
  }

  const forEachCell = (r: CellRange, visit: (cx: number, cy: number) => void): void => {
    for (let cx = r.cx0; cx <= r.cx1; cx++) {
      for (let cy = r.cy0; cy <= r.cy1; cy++) visit(cx, cy)
    }
  }

  const contains = (r: CellRange, cx: number, cy: number): boolean =>
    cx >= r.cx0 && cx <= r.cx1 && cy >= r.cy0 && cy <= r.cy1

  const setAll = (value: string): void => {
    for (const target of targets) {
      for (const node of target.nodes) node.style.display = value
    }
    refs.clear()
    rendered = value === 'none' ? 0 : targets.length
    range = null
  }

  index()
  if (isEnabled) setAll('none')

  return {
    update(viewport, viewWidth, viewHeight) {
      if (!isEnabled) return

      const right = viewport.x + viewWidth / viewport.zoom
      const bottom = viewport.y + viewHeight / viewport.zoom
      const next: CellRange = {
        cx0: Math.floor(viewport.x / CELL_SIZE) - MARGIN_CELLS,
        cy0: Math.floor(viewport.y / CELL_SIZE) - MARGIN_CELLS,
        cx1: Math.floor(right / CELL_SIZE) + MARGIN_CELLS,
        cy1: Math.floor(bottom / CELL_SIZE) + MARGIN_CELLS,
      }

      const previous = range
      if (
        previous &&
        previous.cx0 === next.cx0 &&
        previous.cy0 === next.cy0 &&
        previous.cx1 === next.cx1 &&
        previous.cy1 === next.cy1
      ) {
        return
      }
      range = next

      // Entering cells are retained before leaving ones are released, so a target in both never
      // passes through a hidden state and never triggers a needless style write.
      forEachCell(next, (cx, cy) => {
        if (previous && contains(previous, cx, cy)) return
        for (const key of cells.get(keyOf(cx, cy)) ?? []) retain(key)
      })
      if (previous) {
        forEachCell(previous, (cx, cy) => {
          if (contains(next, cx, cy)) return
          for (const key of cells.get(keyOf(cx, cy)) ?? []) release(key)
        })
      }
    },

    rebuild() {
      index()
      if (isEnabled) setAll('none')
    },

    pin(keys) {
      if (!isEnabled) return
      for (const key of pinned) release(key)
      pinned = [...keys]
      for (const key of pinned) retain(key)
    },

    unpinAll() {
      if (!isEnabled) return
      for (const key of pinned) release(key)
      pinned = []
    },

    setEnabled(next) {
      if (next === isEnabled) return
      isEnabled = next
      pinned = []
      setAll(next ? 'none' : '')
    },

    isEnabled: () => isEnabled,
    renderedCount: () => (isEnabled ? rendered : targets.length),
  }
}
