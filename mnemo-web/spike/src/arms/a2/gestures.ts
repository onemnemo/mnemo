/**
 * Pointer and wheel handling for the hand-rolled arm.
 *
 * Three listeners in total, all on the pane, plus the window listeners a live gesture needs.
 * There is no per-element listener: a press is resolved by walking up from the event target,
 * which is one `closest` call rather than five thousand registrations. That matters beyond
 * memory, because per-node listeners are also per-node teardown on every structural change.
 *
 * Move and up are bound to the window rather than to the pressed node. A real gesture continues
 * when the cursor leaves the element it started on, and it must also survive the element being
 * removed mid-drag. This is the same reason d3-drag reaches for `event.view`, and it is why the
 * harness had to learn to put a `view` on its synthetic events.
 */

import type { MoveOpLike, Point, Viewport } from '../../harness/contract'
import { panBy, zoomAt } from './camera'
import { planDrag, positionAt, type DragPlan } from './drag-plan'
import type { SceneIndex } from './scene-index'

export interface GestureDeps {
  readonly pane: HTMLElement
  readonly scene: SceneIndex
  getViewport(): Viewport
  /** Commits a camera: writes the world transform and updates the level-of-detail band. */
  setViewport(viewport: Viewport): void
  membersOf(id: string): readonly string[] | undefined
  getSelection(): ReadonlySet<string>
  setSelection(ids: readonly string[]): void
  /**
   * Keeps the moving elements rendered for the duration of the gesture. A dragged element can
   * be carried outside the culler's view, and an element that vanished mid-drag would be a
   * spectacular bug rather than a saving.
   */
  pin(ids: readonly string[]): void
  unpinAll(): void
  /** Called once at pointer-up with the operations the arm would send. */
  commitOps(ops: readonly MoveOpLike[]): void
}

interface PanGesture {
  readonly kind: 'pan'
  readonly startClient: Point
  readonly startViewport: Viewport
}

interface DragGesture {
  readonly kind: 'drag'
  readonly startClient: Point
  /** Fixed at press time: a zoom change mid-drag must not re-scale the delta already travelled. */
  readonly zoom: number
  readonly plan: DragPlan
  /** Resolved once, because membership cannot change inside a gesture. */
  readonly dirtyEdges: readonly string[]
}

type Gesture = PanGesture | DragGesture

export function installGestures(deps: GestureDeps): () => void {
  const { pane, scene } = deps
  let gesture: Gesture | null = null

  const applyDrag = (g: DragGesture, clientX: number, clientY: number): void => {
    const dx = (clientX - g.startClient.x) / g.zoom
    const dy = (clientY - g.startClient.y) / g.zoom
    scene.writePositions(g.plan.ids, (id) => positionAt(g.plan, id, dx, dy))
    scene.repaintEdges(g.dirtyEdges)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!gesture) return
    if (gesture.kind === 'pan') {
      deps.setViewport(
        panBy(
          gesture.startViewport,
          event.clientX - gesture.startClient.x,
          event.clientY - gesture.startClient.y,
        ),
      )
      return
    }
    applyDrag(gesture, event.clientX, event.clientY)
  }

  const endGesture = (): void => {
    if (gesture?.kind === 'drag') deps.unpinAll()
    gesture = null
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('pointercancel', onPointerCancel, true)
  }

  function onPointerUp(event: PointerEvent): void {
    if (!gesture) return
    const finished = gesture
    if (finished.kind === 'drag') {
      applyDrag(finished, event.clientX, event.clientY)
      const ops: MoveOpLike[] = []
      for (const id of finished.plan.ids) {
        const position = scene.positionOf(id)
        // Exactly one operation per moved element, in the order the plan resolved them. The
        // plan is already deduplicated, so an element that is both a frame member and
        // independently selected is written once rather than twice by two paths that each
        // believed they owned it.
        if (position) ops.push({ id, x: position.x, y: position.y })
      }
      deps.commitOps(ops)
    }
    endGesture()
  }

  /**
   * A cancelled gesture is undone rather than committed. The pointer never came up, so the
   * user never said "leave it there", and emitting operations for it would persist a move
   * nobody made.
   */
  function onPointerCancel(): void {
    if (gesture?.kind === 'drag') {
      const plan = gesture.plan
      scene.writePositions(plan.ids, (id) => plan.origins.get(id))
      scene.repaintEdges(gesture.dirtyEdges)
    }
    endGesture()
  }

  const beginGesture = (next: Gesture): void => {
    gesture = next
    // Capture phase, so a gesture is never intercepted by anything that stops propagation on
    // its way up from a node.
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || gesture) return

    const target = event.target instanceof Element ? event.target : null
    const host = target?.closest<HTMLElement>('.a2-node')
    const pressedId = host?.dataset.mmId

    if (!pressedId) {
      beginGesture({
        kind: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startViewport: deps.getViewport(),
      })
      return
    }

    // Pressing outside the selection replaces it, which is what tells a renderer the previous
    // selection is over. Without this, a group drag would silently follow any selection left
    // behind by an earlier gesture.
    const selection = deps.getSelection()
    if (!selection.has(pressedId)) deps.setSelection([])

    const plan = planDrag({
      pressedId,
      selection: deps.getSelection(),
      membersOf: deps.membersOf,
      positionOf: (id) => scene.positionOf(id),
    })

    deps.pin(plan.ids)
    beginGesture({
      kind: 'drag',
      startClient: { x: event.clientX, y: event.clientY },
      zoom: deps.getViewport().zoom,
      plan,
      dirtyEdges: scene.incidentEdges(plan.ids),
    })
  }

  const onWheel = (event: WheelEvent): void => {
    // Not passive: the browser's own page zoom and scroll would otherwise both fire alongside
    // the canvas gesture.
    event.preventDefault()
    const rect = pane.getBoundingClientRect()
    const viewport = deps.getViewport()
    if (event.ctrlKey) {
      deps.setViewport(zoomAt(viewport, event.deltaY, event.clientX - rect.left, event.clientY - rect.top))
      return
    }
    deps.setViewport(panBy(viewport, -event.deltaX, -event.deltaY))
  }

  pane.addEventListener('pointerdown', onPointerDown)
  pane.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    pane.removeEventListener('pointerdown', onPointerDown)
    pane.removeEventListener('wheel', onWheel)
    endGesture()
  }
}
