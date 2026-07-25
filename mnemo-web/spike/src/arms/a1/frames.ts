import type { NodePositionChange, NodeChange } from '@xyflow/react'
import type { MoveOpLike, Point } from '../../harness/contract'

/**
 * Frame membership on top of React Flow, without using its parenting.
 *
 * React Flow's `parentId` grouping is the obvious fit and it is the wrong one. Its child
 * coordinates are parent-relative where every Mnemo element is absolute; it requires
 * parents to precede children in the node array; and its grouping is derived containment
 * where Mnemo's is an explicit id list a user edits freely. Reconciling all three would be
 * a translation layer paid on every add, remove and move, forever.
 *
 * So frames are ordinary nodes, and dragging one is intercepted here: a position change
 * for a frame produces identical-delta changes for every id in its membership list.
 *
 * Two details are not optional.
 *
 * **Origins are snapshotted at drag start** and every subsequent position is written as
 * origin plus total delta, rather than accumulating a per-event delta onto the current
 * position. Accumulation drifts over a long gesture, and members drifting apart from their
 * frame is precisely the failure this design exists to prevent.
 *
 * **A member that is itself selected is dropped from its own move.** React Flow emits a
 * position change for every selected node, so a selected member inside a selected frame
 * would be written twice. The positions would agree, but the emitted operation list would
 * carry two moves for one element, and that list is what a server would receive.
 */

export interface FrameDragState {
  readonly frameId: string
  readonly frameOrigin: Point
  readonly memberOrigins: ReadonlyMap<string, Point>
}

/**
 * Every frame moving in the current gesture, keyed by frame id.
 *
 * A map rather than a single frame because a selection can hold more than one. React Flow
 * emits a position change per selected node, so a drag of a selection containing two frames
 * produces two frame changes in one batch. Taking only the first silently carries that frame's
 * members and abandons the other's, which looks like a frame whose contents simply did not
 * move, with nothing anywhere reporting an error.
 */
type ActiveFrameDrags = Map<string, FrameDragState>

export interface FrameInterceptorDeps {
  /** Membership list per frame id. Explicit, never derived from geometry or hierarchy. */
  readonly membersOf: (frameId: string) => readonly string[] | undefined
  /**
   * Absolute positions for a set of ids, resolved in ONE pass over the arm's state.
   *
   * Deliberately bulk rather than per-id: resolving a 120-member frame one lookup at a
   * time against a 5,000-element array is 600,000 comparisons of harness cost that would
   * be charged to the arm. Called once per drag, at drag start, never per pointer move.
   */
  readonly snapshotPositions: (ids: readonly string[]) => ReadonlyMap<string, Point>
  readonly isFrame: (id: string) => boolean
}

export interface FrameInterceptor {
  /** Rewrites a React Flow change list so frame drags carry their members. */
  apply(changes: NodeChange[]): NodeChange[]
  /** Operations accumulated at the end of the last completed drag, drained and cleared. */
  drainOps(): readonly MoveOpLike[]
  reset(): void
}

function isPositionChange(change: NodeChange): change is NodePositionChange {
  return change.type === 'position'
}

export function createFrameInterceptor(deps: FrameInterceptorDeps): FrameInterceptor {
  let drags: ActiveFrameDrags = new Map()
  let pendingOps: MoveOpLike[] = []

  const beginDrag = (frameId: string): FrameDragState | null => {
    const memberIds = deps.membersOf(frameId) ?? []
    const snapshot = deps.snapshotPositions([frameId, ...memberIds])

    const frameOrigin = snapshot.get(frameId)
    if (!frameOrigin) return null

    const memberOrigins = new Map<string, Point>()
    for (const memberId of memberIds) {
      const origin = snapshot.get(memberId)
      // A membership list can name an element that no longer exists. The desktop tolerates
      // that rather than failing the gesture, so this does too.
      if (origin) memberOrigins.set(memberId, origin)
    }
    return { frameId, frameOrigin, memberOrigins }
  }

  return {
    apply(changes) {
      // EVERY frame in the batch, not the first one found. A selection can hold several, and
      // React Flow emits one position change per selected node.
      const frameMoves = changes.filter(
        (c): c is NodePositionChange => isPositionChange(c) && deps.isFrame(c.id) && c.position != null,
      )

      if (frameMoves.length === 0) {
        // A drag that ended, or a batch with no frame in it. Either way the snapshots are
        // stale and must not survive into the next gesture.
        if (drags.size > 0 && changes.some((c) => isPositionChange(c) && c.dragging === false)) {
          drags = new Map()
        }
        return changes
      }

      const memberChanges: NodePositionChange[] = []
      const carried = new Set<string>()
      const committed: MoveOpLike[] = []
      let anyEnded = false

      for (const frameMove of frameMoves) {
        if (!frameMove.position) continue

        let drag = drags.get(frameMove.id)
        if (!drag) {
          const started = beginDrag(frameMove.id)
          if (!started) continue
          drag = started
          drags.set(frameMove.id, drag)
        }

        const dx = frameMove.position.x - drag.frameOrigin.x
        const dy = frameMove.position.y - drag.frameOrigin.y

        for (const [memberId, origin] of drag.memberOrigins) {
          // An element belongs to at most one frame, but a stale membership list could still
          // name the same id twice. Writing it once keeps the op payload free of duplicates,
          // which is the property the commit below is asserted on.
          if (carried.has(memberId)) continue
          carried.add(memberId)
          memberChanges.push({
            id: memberId,
            type: 'position',
            position: { x: origin.x + dx, y: origin.y + dy },
            dragging: frameMove.dragging,
          })
        }

        if (frameMove.dragging === false) {
          anyEnded = true
          committed.push({ id: frameMove.id, x: frameMove.position.x, y: frameMove.position.y })
        }
      }

      // Drop a carried member's own change: its frame is authoritative for where it lands, so
      // leaving React Flow's version in would write the same element twice from two sources.
      const passthrough = changes.filter((c) => !(isPositionChange(c) && carried.has(c.id)))

      if (anyEnded) {
        pendingOps = [
          ...committed,
          ...memberChanges.map((c) => ({ id: c.id, x: c.position?.x ?? 0, y: c.position?.y ?? 0 })),
        ]
        drags = new Map()
      }

      return [...passthrough, ...memberChanges]
    },

    drainOps() {
      const ops = pendingOps
      pendingOps = []
      return ops
    },

    reset() {
      drags = new Map()
      pendingOps = []
    },
  }
}
