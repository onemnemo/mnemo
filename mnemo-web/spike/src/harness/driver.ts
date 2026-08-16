/**
 * Drives pan, zoom, drag and typing gestures against an `ArmHandle` and proves each one
 * landed. This is the most dangerous module in the harness: a gesture that silently fails
 * to reach the arm produces a perfect idle frame histogram, and an idle histogram is
 * indistinguishable from a fast one unless something asserts the gesture actually arrived.
 *
 * Three rules follow from that, and all three are structural rather than advisory:
 *
 * 1. Gestures are driven for a DURATION, one input per animation frame, so a gating gesture
 *    collects hundreds of driven frames. A step count collapses to one frame per step and
 *    leaves a window so short that p95, p99 and max are the same single observation.
 * 2. Every gesture writes its proofs into the `ProofLedger` the driver was constructed with,
 *    and the array a `RunResult` needs can only come from sealing that ledger against a
 *    stated minimum. Proofs cannot be forgotten at a call site, and an abort still leaves
 *    behind everything proven up to it.
 * 3. Every dispatched input is counted against what the arm's own observable state did with
 *    it. That is the drop detector: it proves the arm's handler ran, which is strictly more
 *    than any platform-side event count can say about a synthetic event.
 */

import type {
  ArmHandle,
  FramePhase,
  MoveOpLike,
  Point,
  ProofOfExecution,
  Viewport,
} from './contract'
import {
  canvasPointToClient,
  clientPointToCanvas,
  defaultPanDeltaToViewportDelta,
  fitWheelSensitivity,
  interpolateZoomLog,
  pointDelta,
  pressPointCandidates,
  withinTolerance,
  wheelDeltaForZoomRatio,
  type ContainerOrigin,
  type Tolerance,
  type ZoomSample,
} from './driver-geometry'
import {
  awaitFrames,
  driveFrames,
  nextAnimationFrame,
  DEFAULT_STALL_TIMEOUT_MS,
  type DrivenWindow,
} from './driver-clock'
import { ProofLedger, buildProof } from './driver-proofs'
import {
  fireBeforeInput,
  fireInput,
  fireKeyEvent,
  firePointerEvent,
  fireWheelEvent,
  locateHitNode,
  nextPointerId,
  placeCaretAtEnd,
  insertCharNatively,
  readTargetText,
  type PointerDispatchState,
} from './driver-events'

export {
  findZoomCrossings,
  framesInWindow,
  worstFrameDtInWindow,
  type ZoomCrossing,
  type ZoomSample,
} from './driver-geometry'
export {
  awaitFrames,
  awaitSettled,
  driveFrames,
  nextAnimationFrame,
  FrameClockStallError,
  DEFAULT_STALL_TIMEOUT_MS,
  type AwaitSettledOptions,
  type DrivenWindow,
  type SettleResult,
} from './driver-clock'
export { ProofLedger, abortIfProofsFailed, buildProof, failedProofs } from './driver-proofs'

/**
 * Ten seconds of continuous motion, which is the run structure every gating scenario is
 * specified in and is what makes p95, p99 and max three different numbers: roughly 600
 * driven frames at 60Hz and 300 at 30Hz.
 */
export const DEFAULT_GATING_DURATION_MS = 10_000

/** Motion driven before the measured window opens, so first-frame cost is not measured. */
export const DEFAULT_WARMUP_MS = 500

/**
 * The floor a gating gesture must clear. Below this the percentile columns stop being
 * percentiles: for n under 20 the 95th and 99th are both literally the maximum, so three
 * identical numbers print as a converged distribution when they are one observation.
 */
export const MIN_DRIVEN_FRAMES = 200

/** Latency samples a gating typing run must collect, for the same reason as the frame floor. */
export const MIN_LATENCY_SAMPLES = 200

/**
 * About 20 characters a second: the fast end of human typing, chosen deliberately because a
 * latency probe should stress the input path rather than idle between keystrokes.
 */
export const DEFAULT_PER_CHAR_MS = 50

/**
 * Longer than the pan and drag windows because the sample count that matters here is one
 * per character, not one per frame. At the pacing above this clears 200 samples at both the
 * 60Hz and the 30Hz regime, where a 10s window would fall short and abort every run.
 */
export const DEFAULT_TYPING_DURATION_MS = 20_000

/**
 * Applied in CLIENT space, after the canvas-to-client conversion. In canvas space this
 * inset would shrink with zoom, and at the 0.1 to 0.15 zooms the LOD scenarios care about
 * a 4-unit canvas inset is half a client pixel, i.e. exactly the shared boundary pixel the
 * inset exists to step off.
 */
const DRAG_HIT_INSET_PX = 4

/**
 * How much of its intended duration a gesture must have run for its frame count to be treated
 * as a measurement of the arm rather than as a truncated window.
 */
const COMPLETED_DURATION_RATIO = 0.9

/**
 * How many trailing dispatches may leave the arm's rounded state unchanged before the gesture
 * counts as having stopped responding. A path's final steps are its smallest, so a strict
 * last-dispatch check fails hardest on exactly the slow arms it is least informative about.
 */
const FINAL_RESPONSE_SLACK = 5

/** How far the pan press-point probe drags before asking whether the viewport moved. */
const PAN_PROBE_PX = 8

/** Wheel-delta magnitude for the single sensitivity probe zoomSweep fires before its sweep. */
const PROBE_WHEEL_MAGNITUDE = 120

/** Frames a typed character may take to appear in the arm's own state before it counts as dropped. */
const DEFAULT_MAX_FRAMES_PER_CHAR = 20

const DEFAULT_POSITION_TOLERANCE: Tolerance = { relative: 0.15, absoluteFloor: 2 }
const DEFAULT_ZOOM_TOLERANCE: Tolerance = { relative: 0.1, absoluteFloor: 0.01 }

/** S7's own threshold is "exact, every frame"; this allows only floating-point slop, not gesture noise. */
const EXACT_DELTA_TOLERANCE: Tolerance = { relative: 0, absoluteFloor: 0.01 }

/**
 * State versus committed is one quantity read two ways, so it is a near-equality check and
 * never a magnitude tolerance. A relative tolerance there would pass a transform that is
 * permanently one gesture step behind the state, which is precisely the "state updated but
 * never committed" failure the split proof exists to detect.
 */
const COMMITTED_POSITION_TOLERANCE: Tolerance = { relative: 0, absoluteFloor: 0.5 }
const COMMITTED_ZOOM_TOLERANCE: Tolerance = { relative: 0, absoluteFloor: 0.001 }

// ---- input delivery ------------------------------------------------------------------

export interface InputDeliveryCounts {
  readonly dispatched: number
  readonly observed: number
  /** Whether the arm still responded to the final input, not merely to the first ones. */
  readonly lastConfirmed: boolean
}

/**
 * Counts, per dispatched input, whether the arm's own observable state advanced because of
 * it. This is the drop detector. It deliberately reads the arm rather than any platform
 * event count: Event Timing only records user-agent-generated events, so a synthetic
 * gesture is invisible to it, and a listener count would only prove an event reached a node,
 * not that the arm did anything with it.
 *
 * One frame of slack is allowed, so an arm that batches its state write into the next frame
 * is credited rather than reported as dropping every input.
 */
class InputResponseTracker {
  private readonly read: () => string
  private lastSeen: string
  private pending = false
  private dispatched = 0
  private observed = 0
  /** Dispatch index at which the arm's state was last seen to advance. */
  private lastObservedAt = 0

  constructor(read: () => string) {
    this.read = read
    this.lastSeen = read()
  }

  /** Call immediately before dispatching, which also credits a dispatch the arm has caught up on. */
  beforeDispatch(): void {
    this.settle()
    this.dispatched += 1
    this.pending = true
  }

  /** Call immediately after dispatching, so a synchronous handler is credited in the same frame. */
  afterDispatch(): void {
    this.settle()
  }

  private settle(): void {
    const now = this.read()
    if (now === this.lastSeen) return
    this.lastSeen = now
    if (this.pending) {
      this.observed += 1
      this.lastObservedAt = this.dispatched
      this.pending = false
    }
  }

  finish(): InputDeliveryCounts {
    this.settle()
    // "Did the arm still respond near the end" rather than "did the very last dispatch move
    // it". The final steps of a gesture are its smallest: a path is interpolated to a fraction
    // that saturates at 1, so the last move can be sub-pixel and legitimately leave the arm's
    // rounded state unchanged. Failing on that reports a delivered gesture as undelivered,
    // which is exactly backwards on a slow arm, where the last steps are smallest of all.
    const dispatchesSinceChange = this.dispatched - this.lastObservedAt
    return {
      dispatched: this.dispatched,
      observed: this.observed,
      lastConfirmed: this.observed > 0 && dispatchesSinceChange <= FINAL_RESPONSE_SLACK,
    }
  }
}

function serializeViewport(viewport: Viewport): string {
  return `${viewport.x},${viewport.y},${viewport.zoom}`
}

function serializePoint(point: Point | undefined): string {
  return point ? `${point.x},${point.y}` : 'missing'
}

// ---- gesture options and results -----------------------------------------------------

export interface DrivenGestureOptions {
  /** Length of the MEASURED window. Warmup motion is driven on top of this, not out of it. */
  readonly durationMs?: number
  readonly warmupMs?: number
  /** Below this the gesture is not a measurement; it aborts rather than reporting percentiles. */
  readonly minDrivenFrames?: number
}

export interface GestureResult {
  readonly proofs: readonly ProofOfExecution[]
  /** Absolute bounds of what was driven, joinable against `FrameSample.t`. */
  readonly window: DrivenWindow
  readonly inputs: InputDeliveryCounts
}

export interface PanOptions extends DrivenGestureOptions {
  readonly dx: number
  readonly dy: number
}

export interface PanResult extends GestureResult {
  readonly pressPoint: Point
  /** Candidate press points rejected before one provably panned rather than dragging a node. */
  readonly pressCandidatesRejected: number
}

export interface ZoomSweepOptions extends DrivenGestureOptions {
  readonly from: number
  readonly to: number
  /** Sweeps back to `from` over the second half, so both LOD crossings sit in one driven window. */
  readonly returnToStart?: boolean
}

/** `zoom` rather than `actualZoom` so a sample is directly a `ZoomSample` for `findZoomCrossings`. */
export interface ZoomSweepSample extends ZoomSample {
  readonly intendedZoom: number
}

export interface ZoomSweepResult extends GestureResult {
  /** Driven-phase samples only: a crossing found in warmup would be attributed to measured frames. */
  readonly samples: readonly ZoomSweepSample[]
  readonly wheelSensitivity: number
}

export interface DragElementOptions extends DrivenGestureOptions {
  readonly id: string
  readonly dx: number
  readonly dy: number
  /**
   * Ids expected to move by the identical delta as `id` (a frame's members). When supplied,
   * the drag also asserts every one of them moved by the delta the dragged element ACHIEVED,
   * and that each emitted exactly one MoveOp carrying the matching coordinates, which is the
   * frame-membership correctness evidence riding the same gesture.
   */
  readonly memberIds?: readonly string[]
}

export interface TypeTextOptions {
  readonly target: HTMLElement
  /** Typed repeatedly until the duration elapses, so a gating run collects enough samples. */
  readonly text: string
  /**
   * The ARM's own model text for the element being edited. It must NOT read back the DOM node
   * the driver may itself have written to: with native insertion the driver inserts the
   * characters, so a probe pointed at that node would assert the driver against itself and a
   * completely dead page would pass.
   */
  readonly readArmText: () => string
  readonly durationMs?: number
  readonly warmupMs?: number
  readonly perCharMs?: number
  readonly maxFramesPerChar?: number
  readonly minLatencySamples?: number
  readonly minDrivenFrames?: number
  /**
   * Corroboration only. Event Timing never records synthetic dispatch, so its absence is a
   * recorded fact and never an abort or a fail.
   */
  readonly eventTimingEntryCount?: () => number
}

export interface TypeTextResult extends GestureResult {
  /** Dispatch to the frame in which the arm's own state carried the character. */
  readonly dispatchToPaintedMs: readonly number[]
  readonly charsDispatched: number
  readonly charsObserved: number
  readonly nativeInsertions: number
  readonly handlerInsertions: number
  /** Null when no Event Timing probe was supplied; 0 is the expected reading under synthetic dispatch. */
  readonly eventTimingEntriesObserved: number | null
}

export interface GestureDriverOptions {
  /** Required: proofs are collected mechanically so no call site can forget to keep them. */
  readonly ledger: ProofLedger
  readonly win?: Window
  /** Tags frames by window. Without it the calibration probe lands in the measured phase. */
  readonly setPhase?: (phase: FramePhase) => void
  readonly panDeltaToViewportDelta?: (dx: number, dy: number, zoom: number) => Point
  readonly positionTolerance?: Tolerance
  readonly zoomTolerance?: Tolerance
  readonly memberDeltaTolerance?: Tolerance
  readonly committedPositionTolerance?: Tolerance
  readonly committedZoomTolerance?: Tolerance
  readonly pointerType?: string
  readonly mouseCompat?: boolean
  readonly stallTimeoutMs?: number
  /** Canvas-space occupancy, supplied by the scenario, which is what holds the fixture. */
  readonly isCanvasPointOccupied?: (point: Point) => boolean
}

/**
 * Drives an `ArmHandle` through the gestures a real user session exercises and proves each
 * one landed. One driver per arm instance; nothing here is shared across arms or runs.
 */
export class GestureDriver {
  private readonly arm: ArmHandle
  private readonly ledger: ProofLedger
  private readonly win: Window
  private readonly setPhase: (phase: FramePhase) => void
  private readonly panDeltaToViewportDelta: (dx: number, dy: number, zoom: number) => Point
  private readonly positionTolerance: Tolerance
  private readonly zoomTolerance: Tolerance
  private readonly memberDeltaTolerance: Tolerance
  private readonly committedPositionTolerance: Tolerance
  private readonly committedZoomTolerance: Tolerance
  private readonly pointerType: string
  private readonly mouseCompat: boolean
  private readonly stallTimeoutMs: number
  private readonly isCanvasPointOccupied: ((point: Point) => boolean) | undefined

  constructor(arm: ArmHandle, options: GestureDriverOptions) {
    this.arm = arm
    this.ledger = options.ledger
    this.win = options.win ?? window
    this.setPhase = options.setPhase ?? ((): void => {})
    this.panDeltaToViewportDelta = options.panDeltaToViewportDelta ?? defaultPanDeltaToViewportDelta
    this.positionTolerance = options.positionTolerance ?? DEFAULT_POSITION_TOLERANCE
    this.zoomTolerance = options.zoomTolerance ?? DEFAULT_ZOOM_TOLERANCE
    this.memberDeltaTolerance = options.memberDeltaTolerance ?? EXACT_DELTA_TOLERANCE
    this.committedPositionTolerance = options.committedPositionTolerance ?? COMMITTED_POSITION_TOLERANCE
    this.committedZoomTolerance = options.committedZoomTolerance ?? COMMITTED_ZOOM_TOLERANCE
    this.pointerType = options.pointerType ?? 'mouse'
    this.mouseCompat = options.mouseCompat ?? true
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
    this.isCanvasPointOccupied = options.isCanvasPointOccupied
  }

  private newPointerState(): PointerDispatchState {
    return { pointerId: nextPointerId(), pointerType: this.pointerType, mouseCompat: this.mouseCompat }
  }

  private containerOrigin(container: HTMLElement): ContainerOrigin {
    const rect = container.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  }

  private frames(n: number): Promise<void> {
    return awaitFrames(n, this.win, this.stallTimeoutMs)
  }

  /**
   * Records the failure before throwing, so the ledger still carries the evidence of what
   * went wrong when the run is assembled from it.
   */
  private abort(gesture: string, expected: string, actual: string): never {
    const proof = this.ledger.record(buildProof(gesture, false, false, expected, actual))
    throw new Error(`${proof.gesture} aborted: expected ${expected}; actual ${actual}`)
  }

  /**
   * Called after the gesture's own proofs are recorded, never before: the ledger keeps whatever
   * did land, and an abort is the last thing to happen rather than the thing that throws the
   * evidence away.
   *
   * A frame count below the floor has two completely different causes and they lead to opposite
   * conclusions. If the gesture was cut short, nothing was measured and the run is void. If the
   * gesture ran for its full intended duration and simply could not produce that many frames,
   * then the arm's frame rate IS the measurement, and it is the one the scenario exists to
   * take. Aborting there would throw away the finding and label the slowest possible result
   * "unmeasurable", which reads as a harness problem rather than as an arm that cannot keep up.
   *
   * So a short window only aborts when the gesture did not run its course. Otherwise the
   * shortfall is recorded, the percentiles are marked degraded by the summarizer, and the
   * cadence thresholds fail it on the numbers.
   */
  private assertDrivenFrameFloor(
    gesture: string,
    window: DrivenWindow,
    minimum: number,
    intendedDurationMs?: number,
  ): void {
    if (window.drivenFrames >= minimum) return

    const elapsed = window.endedAt - window.drivenStartedAt
    const ranItsCourse =
      intendedDurationMs === undefined || elapsed >= intendedDurationMs * COMPLETED_DURATION_RATIO

    if (ranItsCourse) {
      // Not an abort. The gesture happened, for as long as it was meant to, and this is how
      // many frames the arm managed in that time.
      this.ledger.record(
        buildProof(
          `${gesture}:frameRate`,
          true,
          true,
          `the gesture to run for its full ${intendedDurationMs ?? elapsed}ms`,
          `${window.drivenFrames} driven frames over ${elapsed.toFixed(0)}ms, ` +
            `about ${((window.drivenFrames / elapsed) * 1000).toFixed(1)} frames per second, ` +
            `below the ${minimum}-frame floor for stable tail percentiles`,
        ),
      )
      return
    }

    this.abort(
      `${gesture}:sampleFloor`,
      `the gesture to run for its full ${intendedDurationMs}ms so its frame count means something`,
      `the window closed after only ${elapsed.toFixed(0)}ms with ${window.drivenFrames} driven frames, ` +
        'so the gesture was cut short rather than merely slow',
    )
  }

  private readCommitted(): Viewport | null {
    return this.arm.readCommittedViewport()
  }

  private committedAgrees(state: Viewport, committed: Viewport | null): boolean {
    return (
      committed !== null &&
      withinTolerance(state.x, committed.x, this.committedPositionTolerance) &&
      withinTolerance(state.y, committed.y, this.committedPositionTolerance) &&
      withinTolerance(state.zoom, committed.zoom, this.committedZoomTolerance)
    )
  }

  private describeViewport(viewport: Viewport | null): string {
    return viewport
      ? `(${viewport.x.toFixed(2)}, ${viewport.y.toFixed(2)}, zoom ${viewport.zoom.toFixed(4)})`
      : 'null'
  }

  /**
   * Proves the arm actually received the input stream, rather than that every single dispatch
   * produced a distinguishable state change.
   *
   * Those are different claims, and demanding the second one is wrong. A gesture driven for ten
   * seconds along a 400px path advances well under a pixel per frame, so most dispatches
   * legitimately land on the same rounded position as the one before, and an arm that received
   * every one of them still reports far fewer observations than dispatches. Requiring equality
   * would fail a perfectly delivered gesture for being slow and short, which is exactly the
   * shape the sample-count floor forces gestures into.
   *
   * `resolvableSteps` is how many distinct positions the path could produce at all. Below that
   * ceiling the check is a ratio; the final input must always be observed, since a gesture whose
   * last move never landed is genuinely broken regardless of what came before.
   */
  /**
   * Proves the gesture reached the arm. Deliberately NOT a measure of how promptly it was
   * absorbed, which is a different question with a different answer.
   *
   * Inputs here are dispatched synchronously into synchronous handlers, so an event cannot be
   * lost in transit: if the first and last ones moved the arm and the total magnitude is right,
   * every one in between arrived. What the observed-versus-dispatched ratio actually varies with
   * is whether the arm's state had changed by the time the next frame read it, which is commit
   * timing under load. A slow arm coalesces, and gating delivery on that ratio reports slowness
   * as a failure to deliver, which then hides the real finding behind an aborted run. The ratio
   * is reported instead, and the frame statistics are where slowness belongs.
   */
  private deliveryProof(
    gesture: string,
    inputs: InputDeliveryCounts,
    committedNote: string,
  ): ProofOfExecution {
    const ratio = inputs.dispatched > 0 ? inputs.observed / inputs.dispatched : 0
    return buildProof(
      `${gesture}:inputDelivery`,
      inputs.observed > 0,
      inputs.lastConfirmed,
      "the arm's own state to advance from these inputs, and to still be responding at the end",
      `${inputs.observed} of ${inputs.dispatched} dispatches advanced the arm's state ` +
        `(${(ratio * 100).toFixed(0)}%, a responsiveness reading rather than a delivery one); ` +
        `final input ${inputs.lastConfirmed ? 'observed' : 'never observed'} (${committedNote})`,
    )
  }

  // ---- pan -----------------------------------------------------------------------------

  /**
   * Presses on empty canvas, drags for the requested duration at one pointermove per frame,
   * and releases. `dx`/`dy` are screen-space pixels, matching what a real drag specifies.
   *
   * The press point is resolved rather than assumed. On a 5,000-element fixture the
   * container's geometric centre is almost certainly over an element, and a press on an
   * element starts a node drag: the viewport never moves, and the frames recorded under the
   * label "pan" belong to a different gesture entirely.
   */
  async pan(options: PanOptions): Promise<PanResult> {
    const {
      dx,
      dy,
      durationMs = DEFAULT_GATING_DURATION_MS,
      warmupMs = DEFAULT_WARMUP_MS,
      minDrivenFrames = MIN_DRIVEN_FRAMES,
    } = options

    const target = this.arm.getGestureTarget()
    this.setPhase('warmup')
    const press = await this.resolvePanPressPoint(target)

    const before = this.arm.getViewport()
    const committedBefore = this.readCommitted()
    const state = this.newPointerState()
    const tracker = new InputResponseTracker(() => serializeViewport(this.arm.getViewport()))

    firePointerEvent(target, 'pointerdown', press.point, state)

    const window = await driveFrames({
      win: this.win,
      warmupMs,
      durationMs,
      stallTimeoutMs: this.stallTimeoutMs,
      onPhase: this.setPhase,
      onFrame: (progress) => {
        tracker.beforeDispatch()
        firePointerEvent(
          target,
          'pointermove',
          { x: press.point.x + dx * progress.fraction, y: press.point.y + dy * progress.fraction },
          state,
        )
        tracker.afterDispatch()
      },
    })

    firePointerEvent(target, 'pointerup', { x: press.point.x + dx, y: press.point.y + dy }, state)
    this.setPhase('settle')
    await this.frames(2) // let the commit paint before reading it back
    const inputs = tracker.finish()

    const after = this.arm.getViewport()
    const expectedDelta = this.panDeltaToViewportDelta(dx, dy, before.zoom)
    const actualDelta = pointDelta(before, after)
    const stateMatched =
      withinTolerance(expectedDelta.x, actualDelta.x, this.positionTolerance) &&
      withinTolerance(expectedDelta.y, actualDelta.y, this.positionTolerance)

    const committed = this.readCommitted()
    const committedMatched = this.committedAgrees(after, committed)

    const proofs = this.ledger.recordAll([
      buildProof(
        'pan',
        stateMatched,
        committedMatched,
        `viewport delta ~ (${expectedDelta.x.toFixed(2)}, ${expectedDelta.y.toFixed(2)}) canvas units, ` +
          'committed transform equal to the arm state',
        `viewport delta = (${actualDelta.x.toFixed(2)}, ${actualDelta.y.toFixed(2)}), ` +
          `state ${this.describeViewport(after)}, committed ${this.describeViewport(committed)}`,
      ),
      this.deliveryProof(
        'pan',
        inputs,
        `committed moved from ${this.describeViewport(committedBefore)} to ${this.describeViewport(committed)}`,
      ),
    ])
    this.assertDrivenFrameFloor('pan', window, minDrivenFrames, durationMs)

    return {
      proofs,
      window,
      inputs,
      pressPoint: press.point,
      pressCandidatesRejected: press.rejected,
    }
  }

  /**
   * Walks deterministic candidate points until one provably pans: press, nudge, and check
   * whether the ARM'S VIEWPORT moved. A candidate that moved nothing was over an element, so
   * the probe is cancelled and walked back to its own start point, which nets any node it
   * did grab to zero displacement, and its queued ops are drained so they cannot pollute a
   * later drag's op assertions.
   *
   * The successful candidate's probe pan is undone through `setViewport`, which is scenario
   * setup rather than a measured gesture, so the measured pan starts from the viewport the
   * scenario asked for.
   */
  private async resolvePanPressPoint(
    target: HTMLElement,
  ): Promise<{ readonly point: Point; readonly rejected: number }> {
    const rect = target.getBoundingClientRect()
    const origin: ContainerOrigin = { left: rect.left, top: rect.top }
    const candidates = pressPointCandidates({
      left: rect.left,
      top: rect.top,
      width: rect.width || target.clientWidth,
      height: rect.height || target.clientHeight,
    })

    let rejected = 0
    for (const candidate of candidates) {
      const viewport = this.arm.getViewport()
      if (this.isCanvasPointOccupied?.(clientPointToCanvas(origin, viewport, candidate)) === true) {
        rejected += 1
        continue
      }
      if (locateHitNode(target, candidate.x, candidate.y) !== target) {
        rejected += 1
        continue
      }

      const state = this.newPointerState()
      const nudged = { x: candidate.x + PAN_PROBE_PX, y: candidate.y }
      firePointerEvent(target, 'pointerdown', candidate, state)
      await this.frames(1)
      firePointerEvent(target, 'pointermove', nudged, state)
      await this.frames(1)

      const moved = serializeViewport(this.arm.getViewport()) !== serializeViewport(viewport)
      if (moved) {
        firePointerEvent(target, 'pointerup', nudged, state)
        this.arm.setViewport(viewport)
        this.arm.drainPendingOps()
        await this.frames(1)
        return { point: candidate, rejected }
      }

      firePointerEvent(target, 'pointermove', candidate, state)
      firePointerEvent(target, 'pointercancel', candidate, state)
      firePointerEvent(target, 'pointerup', candidate, state)
      this.arm.drainPendingOps()
      await this.frames(1)
      rejected += 1
    }

    this.abort(
      'pan:pressPoint',
      'at least one point in the viewport where a press pans the canvas rather than dragging an element',
      `all ${candidates.length} candidate points failed to move the viewport; ` +
        'the arm either ignores pointer input entirely or every candidate was over an element',
    )
  }

  // ---- zoom ----------------------------------------------------------------------------

  /**
   * A wheel zoom sweep. The deltaY-to-zoom mapping is arm-specific, so the sweep calibrates
   * itself once against the arm and then re-aims from the observed zoom every frame.
   *
   * The calibration probe and the two viewport resets around it are held in the warmup
   * phase: they are a wheel-driven zoom plus two whole-document re-renders, the most
   * expensive frames in the scenario, and pooling them with the measured steps lets the
   * probe alone set the max and p99 the gate reads.
   *
   * A probe that produces no zoom response aborts. It is the clearest possible signal that
   * wheel events are not reaching the arm, and falling back to a fixed wheel magnitude would
   * replace it with blind dispatches that can still land near the target by luck.
   */
  async zoomSweep(options: ZoomSweepOptions): Promise<ZoomSweepResult> {
    const {
      from,
      to,
      returnToStart = false,
      durationMs = DEFAULT_GATING_DURATION_MS,
      warmupMs = DEFAULT_WARMUP_MS,
      minDrivenFrames = MIN_DRIVEN_FRAMES,
    } = options

    const target = this.arm.getGestureTarget()
    const rect = target.getBoundingClientRect()
    const center = {
      x: rect.left + (rect.width || target.clientWidth) / 2,
      y: rect.top + (rect.height || target.clientHeight) / 2,
    }

    this.setPhase('warmup')
    this.arm.setViewport({ ...this.arm.getViewport(), zoom: from })
    await this.frames(1)

    const beforeProbe = this.arm.getViewport().zoom
    const probeDeltaY = to >= from ? -PROBE_WHEEL_MAGNITUDE : PROBE_WHEEL_MAGNITUDE
    fireWheelEvent(target, center, probeDeltaY)
    await this.frames(2)
    const afterProbe = this.arm.getViewport().zoom
    const sensitivity = fitWheelSensitivity(probeDeltaY, beforeProbe, afterProbe)

    if (sensitivity === 0) {
      this.abort(
        'zoomSweep:sensitivityProbe',
        `a wheel event with deltaY ${probeDeltaY} at zoom ${beforeProbe.toFixed(4)} changes the arm's zoom`,
        `zoom stayed at ${afterProbe.toFixed(4)}; the arm did not react to the probe, so the sweep ` +
          'cannot be calibrated and must not be run blind',
      )
    }

    // Undo the probe: it measured the arm's response and has no further part to play.
    this.arm.setViewport({ ...this.arm.getViewport(), zoom: from })
    await this.frames(1)

    const samples: ZoomSweepSample[] = []
    const tracker = new InputResponseTracker(() => String(this.arm.getViewport().zoom))
    let trackingViolations = 0
    let currentZoom = this.arm.getViewport().zoom

    const window = await driveFrames({
      win: this.win,
      warmupMs,
      durationMs,
      stallTimeoutMs: this.stallTimeoutMs,
      onPhase: this.setPhase,
      onFrame: (progress) => {
        const sweepFraction = returnToStart
          ? 1 - Math.abs(1 - 2 * progress.fraction)
          : progress.fraction
        const intendedZoom = interpolateZoomLog(from, to, sweepFraction)
        tracker.beforeDispatch()
        fireWheelEvent(target, center, wheelDeltaForZoomRatio(currentZoom, intendedZoom, sensitivity))
        tracker.afterDispatch()
        currentZoom = this.arm.getViewport().zoom
        if (progress.phase !== 'driven') return
        samples.push({ t: progress.t, zoom: currentZoom, intendedZoom })
        if (!withinTolerance(intendedZoom, currentZoom, this.zoomTolerance)) trackingViolations += 1
      },
    })

    this.setPhase('settle')
    await this.frames(2)
    const inputs = tracker.finish()

    const endZoom = returnToStart ? from : to
    const final = this.arm.getViewport()
    const committed = this.readCommitted()
    const stateMatched = withinTolerance(endZoom, final.zoom, this.zoomTolerance)
    const committedMatched =
      committed !== null && withinTolerance(final.zoom, committed.zoom, this.committedZoomTolerance)

    const observedZooms = samples.map((sample) => sample.zoom)
    const lowest = observedZooms.length > 0 ? Math.min(...observedZooms) : Number.NaN
    const highest = observedZooms.length > 0 ? Math.max(...observedZooms) : Number.NaN
    const sweptRange =
      withinTolerance(Math.min(from, to), lowest, this.zoomTolerance) &&
      withinTolerance(Math.max(from, to), highest, this.zoomTolerance)

    const proofs = this.ledger.recordAll([
      buildProof(
        'zoomSweep',
        stateMatched,
        committedMatched,
        `zoom settles at ${endZoom}, committed zoom equal to the arm state`,
        `zoom = ${final.zoom.toFixed(4)}, committed zoom = ${committed ? committed.zoom.toFixed(4) : 'null'}`,
      ),
      // Tracking is asserted per frame because the loop re-aims from the observed zoom, so
      // the end-state check above is satisfied by the last frame alone: an arm that
      // processes a fraction of the wheel events still converges on the target zoom.
      buildProof(
        'zoomSweep:tracking',
        trackingViolations === 0,
        sweptRange,
        `every driven frame's zoom stays within tolerance of the interpolated schedule, and the ` +
          `sweep visits the whole ${Math.min(from, to)} to ${Math.max(from, to)} range`,
        `${trackingViolations} of ${samples.length} driven frames off schedule; observed range ` +
          `${Number.isNaN(lowest) ? 'none' : lowest.toFixed(4)} to ${Number.isNaN(highest) ? 'none' : highest.toFixed(4)}`,
      ),
      this.deliveryProof('zoomSweep', inputs, `wheel sensitivity ${sensitivity.toExponential(3)}`),
    ])
    this.assertDrivenFrameFloor('zoomSweep', window, minDrivenFrames, durationMs)

    return { proofs, window, inputs, samples, wheelSensitivity: sensitivity }
  }

  // ---- drag ----------------------------------------------------------------------------

  /**
   * Presses at the element's own on-screen position, drags by `(dx, dy)` screen pixels over
   * the requested duration, and releases. When `memberIds` is given, also asserts every one
   * of them moved by the delta the dragged element achieved and emitted exactly one MoveOp
   * carrying the matching coordinates.
   */
  async dragElement(options: DragElementOptions): Promise<GestureResult> {
    const {
      id,
      dx,
      dy,
      memberIds,
      durationMs = DEFAULT_GATING_DURATION_MS,
      warmupMs = DEFAULT_WARMUP_MS,
      minDrivenFrames = MIN_DRIVEN_FRAMES,
    } = options

    const startPos = this.arm.getElementPosition(id)
    if (!startPos) throw new Error(`dragElement: unknown element id "${id}"`)

    const membersBefore: (readonly [string, Point])[] = (memberIds ?? []).map((memberId) => {
      const pos = this.arm.getElementPosition(memberId)
      if (!pos) throw new Error(`dragElement: unknown member id "${memberId}"`)
      return [memberId, pos] as const
    })

    const viewport = this.arm.getViewport()
    const target = this.arm.getGestureTarget()
    const origin = this.containerOrigin(target)
    const corner = canvasPointToClient(origin, viewport, startPos)
    const start = { x: corner.x + DRAG_HIT_INSET_PX, y: corner.y + DRAG_HIT_INSET_PX }
    // Ask the arm which node owns this element before falling back to hit-testing. On a dense
    // canvas the topmost thing at the computed point is regularly a neighbour or an edge drawn
    // over the target, and pressing it drags something real, so the gesture looks fine while
    // the numbers belong to a different element.
    const ownNode = this.arm.getElementNode?.(id) ?? null
    const hitNode = ownNode ?? locateHitNode(target, start.x, start.y)
    const state = this.newPointerState()
    const tracker = new InputResponseTracker(() => serializePoint(this.arm.getElementPosition(id)))

    this.setPhase('warmup')
    // Clears anything stale from scenario setup, so this gesture's op proof reads only what
    // this gesture produced.
    this.arm.drainPendingOps()

    firePointerEvent(hitNode, 'pointerdown', start, state)

    const window = await driveFrames({
      win: this.win,
      warmupMs,
      durationMs,
      stallTimeoutMs: this.stallTimeoutMs,
      onPhase: this.setPhase,
      onFrame: (progress) => {
        tracker.beforeDispatch()
        firePointerEvent(
          hitNode,
          'pointermove',
          { x: start.x + dx * progress.fraction, y: start.y + dy * progress.fraction },
          state,
        )
        tracker.afterDispatch()
      },
    })

    firePointerEvent(hitNode, 'pointerup', { x: start.x + dx, y: start.y + dy }, state)
    this.setPhase('settle')
    await this.frames(2)
    const inputs = tracker.finish()

    const afterPos = this.arm.getElementPosition(id)
    if (!afterPos) throw new Error(`dragElement: element "${id}" disappeared during drag`)

    // A dragged element follows the cursor 1:1 in canvas space: no inversion, just divided
    // back out of screen space by the zoom the drag started at.
    const expectedDelta: Point = { x: dx / viewport.zoom, y: dy / viewport.zoom }
    const achievedDelta = pointDelta(startPos, afterPos)
    const stateMatched =
      withinTolerance(expectedDelta.x, achievedDelta.x, this.positionTolerance) &&
      withinTolerance(expectedDelta.y, achievedDelta.y, this.positionTolerance)

    const ops = this.arm.drainPendingOps()
    const opsForElement = ops.filter((candidate) => candidate.id === id)
    const op = opsForElement.length === 1 ? opsForElement[0] : undefined
    // The op is checked against where the arm itself ended up, not against the intent: it is
    // the same quantity read two ways, so a magnitude tolerance there would pass an op
    // serialized from pre-drag state.
    const committedMatched =
      op !== undefined &&
      withinTolerance(afterPos.x, op.x, this.memberDeltaTolerance) &&
      withinTolerance(afterPos.y, op.y, this.memberDeltaTolerance)

    const proofs: ProofOfExecution[] = [
      buildProof(
        `dragElement:${id}`,
        stateMatched,
        committedMatched,
        `element moves by (${expectedDelta.x.toFixed(2)}, ${expectedDelta.y.toFixed(2)}); ` +
          `pointer-up emits exactly one MoveOp at (${afterPos.x.toFixed(2)}, ${afterPos.y.toFixed(2)})`,
        `element moved by (${achievedDelta.x.toFixed(2)}, ${achievedDelta.y.toFixed(2)}); ` +
          `${opsForElement.length} MoveOp(s), payload ` +
          `${op ? `(${op.x.toFixed(2)}, ${op.y.toFixed(2)})` : 'missing or duplicated'}`,
      ),
      this.deliveryProof(`dragElement:${id}`, inputs, `${ops.length} op(s) drained at pointer-up`),
    ]

    if (memberIds && memberIds.length > 0) {
      proofs.push(this.memberDeltaProof(id, memberIds, membersBefore, achievedDelta, ops))
    }
    this.ledger.recordAll(proofs)
    this.assertDrivenFrameFloor('dragElement', window, minDrivenFrames, durationMs)

    return { proofs, window, inputs }
  }

  /**
   * Members are compared against the delta the dragged element ACHIEVED, not against the
   * driver's intent. Two mismatched tolerances against a common reference is not an equality
   * test: the frame node is allowed gesture noise while members are held to floating-point
   * slack, so a frame leading its members by tens of canvas units passes both checks, and a
   * group that lands slightly off intent while moving perfectly together fails.
   *
   * The commit dimension is the op payload, which is the stand-in for what gets persisted.
   * Counting ops without checking their coordinates certifies nothing: an op serialized from
   * pre-drag state is count-correct and still wrong.
   */
  private memberDeltaProof(
    frameId: string,
    memberIds: readonly string[],
    before: readonly (readonly [string, Point])[],
    achievedDelta: Point,
    ops: readonly MoveOpLike[],
  ): ProofOfExecution {
    const deltaMismatches: string[] = []
    const opMismatches: string[] = []
    let maxDeviation = 0

    for (const [memberId, beforePos] of before) {
      const afterPos = this.arm.getElementPosition(memberId)
      if (!afterPos) {
        deltaMismatches.push(`${memberId}: disappeared`)
        continue
      }
      const delta = pointDelta(beforePos, afterPos)
      maxDeviation = Math.max(
        maxDeviation,
        Math.abs(delta.x - achievedDelta.x),
        Math.abs(delta.y - achievedDelta.y),
      )
      const dxOk = withinTolerance(achievedDelta.x, delta.x, this.memberDeltaTolerance)
      const dyOk = withinTolerance(achievedDelta.y, delta.y, this.memberDeltaTolerance)
      if (!dxOk || !dyOk) deltaMismatches.push(`${memberId}: (${delta.x.toFixed(3)}, ${delta.y.toFixed(3)})`)

      const opsForMember = ops.filter((op) => op.id === memberId)
      if (opsForMember.length !== 1) {
        opMismatches.push(`${memberId}: ${opsForMember.length} MoveOps (expected exactly 1)`)
        continue
      }
      const expectedX = beforePos.x + achievedDelta.x
      const expectedY = beforePos.y + achievedDelta.y
      const memberOp = opsForMember[0]
      if (
        !withinTolerance(expectedX, memberOp.x, this.memberDeltaTolerance) ||
        !withinTolerance(expectedY, memberOp.y, this.memberDeltaTolerance)
      ) {
        opMismatches.push(
          `${memberId}: op (${memberOp.x.toFixed(3)}, ${memberOp.y.toFixed(3)}) ` +
            `should be (${expectedX.toFixed(3)}, ${expectedY.toFixed(3)})`,
        )
      }
    }

    // Ops for elements outside the frame are NOT a violation. The group-drag scenario selects a
    // marquee of other elements alongside the frame precisely so both mechanisms run at once,
    // and those elements are supposed to move. What must never happen is one element being
    // written twice, which is what a frame carrying a member that is also independently
    // selected would produce if both paths emitted for it.
    const seen = new Set<string>()
    const duplicated = new Set<string>()
    for (const op of ops) {
      if (seen.has(op.id)) duplicated.add(op.id)
      seen.add(op.id)
    }
    if (duplicated.size > 0) {
      opMismatches.push(
        `${duplicated.size} element(s) written more than once in one commit: ` +
          `${[...duplicated].join(', ')}`,
      )
    }

    return buildProof(
      `dragElement:${frameId}:memberDeltaEquality`,
      deltaMismatches.length === 0,
      opMismatches.length === 0,
      `all ${memberIds.length} members move by the frame's own achieved delta ` +
        `(${achievedDelta.x.toFixed(2)}, ${achievedDelta.y.toFixed(2)}), and each emits exactly one ` +
        'MoveOp carrying the matching coordinates',
      `deltas: ${deltaMismatches.length === 0 ? `all matched, max deviation ${maxDeviation.toFixed(4)}` : deltaMismatches.join('; ')}; ` +
        `ops: ${opMismatches.length === 0 ? `${memberIds.length} matched` : opMismatches.join('; ')}`,
    )
  }

  // ---- typing --------------------------------------------------------------------------

  /**
   * Types realistic per-character keydown/beforeinput/input/keyup into the arm's editor and
   * measures dispatch-to-painted latency: the interval from dispatching a keystroke to the
   * frame in which the ARM'S OWN observable state carries it. The frame the state is already
   * present in is the frame that paints it, so that timestamp is the painted time.
   *
   * Latency here is deliberately not Event Timing. Event Timing only creates entries for
   * user-agent-generated events, and every event the driver sends is synthetic, so an Event
   * Timing metric could not produce a number for this gesture at all. An Event Timing count
   * may be passed in as corroboration and is recorded either way, never gating.
   *
   * The proof is against the arm, never against the DOM node the driver wrote to: when
   * `beforeinput` is not prevented the driver performs the native insertion itself, so a
   * proof read back off that node would be the driver asserting against itself, and a
   * completely dead page would pass.
   */
  async typeText(options: TypeTextOptions): Promise<TypeTextResult> {
    const {
      target,
      text,
      readArmText,
      durationMs = DEFAULT_TYPING_DURATION_MS,
      warmupMs = DEFAULT_WARMUP_MS,
      perCharMs = DEFAULT_PER_CHAR_MS,
      maxFramesPerChar = DEFAULT_MAX_FRAMES_PER_CHAR,
      minLatencySamples = MIN_LATENCY_SAMPLES,
      minDrivenFrames = MIN_DRIVEN_FRAMES,
    } = options

    if (text.length === 0) throw new Error('typeText: text is empty, so nothing would be dispatched')
    this.assertArmOwnsTarget(target)

    const eventTimingBefore = options.eventTimingEntryCount?.() ?? null
    const baseline = readArmText()
    this.setPhase('warmup')
    placeCaretAtEnd(target)

    const totalMs = warmupMs + durationMs
    const latencies: number[] = []
    let typed = ''
    let charsDispatched = 0
    let charsObserved = 0
    let nativeInsertions = 0
    let handlerInsertions = 0
    let lastCharObserved = false

    let t = await nextAnimationFrame(this.win, this.stallTimeoutMs)
    const startedAt = t
    let drivenStartedAt = -1
    let frames = 1
    let drivenFrames = 0

    const advance = async (driven: boolean): Promise<void> => {
      t = await nextAnimationFrame(this.win, this.stallTimeoutMs)
      frames += 1
      if (driven) drivenFrames += 1
    }

    for (;;) {
      const driven = t - startedAt >= warmupMs
      if (driven && drivenStartedAt < 0) {
        drivenStartedAt = t
        this.setPhase('driven')
      }

      const char = text[charsDispatched % text.length]
      const dispatchedAt = t
      fireKeyEvent(target, 'keydown', char)
      const beforeInputEvent = fireBeforeInput(target, char)
      if (beforeInputEvent.defaultPrevented) {
        handlerInsertions += 1
      } else {
        insertCharNatively(target, char)
        fireInput(target, char)
        nativeInsertions += 1
      }
      fireKeyEvent(target, 'keyup', char)
      charsDispatched += 1
      typed += char

      const expected = baseline + typed
      lastCharObserved = false
      for (let waited = 0; waited < maxFramesPerChar; waited++) {
        await advance(driven)
        if (readArmText() === expected) {
          lastCharObserved = true
          charsObserved += 1
          if (driven) latencies.push(t - dispatchedAt)
          break
        }
      }

      // Paces the typing without leaving the frame clock: `perCharMs` of frame time, so a
      // controllable clock in a test and a real display are driven the same way.
      while (t - dispatchedAt < perCharMs) await advance(driven)

      if (t - startedAt >= totalMs) break
    }

    this.setPhase('settle')
    await this.frames(2)

    const window: DrivenWindow = {
      startedAt,
      drivenStartedAt: drivenStartedAt < 0 ? t : drivenStartedAt,
      endedAt: t,
      frames,
      drivenFrames,
    }
    const armText = readArmText()
    const renderedText = readTargetText(target)
    const inputs: InputDeliveryCounts = {
      dispatched: charsDispatched,
      observed: charsObserved,
      lastConfirmed: lastCharObserved,
    }
    const eventTimingEntriesObserved =
      eventTimingBefore === null ? null : (options.eventTimingEntryCount?.() ?? 0) - eventTimingBefore

    const proofs = this.ledger.recordAll([
      buildProof(
        'typeText',
        armText === baseline + typed,
        // Two genuinely independent views: what the arm's model holds, and what is rendered
        // in the editing host. A second read of the same source would report its strongest
        // value in the total-failure case, which is the one case it must not.
        renderedText === armText,
        `the arm's own text becomes "${(baseline + typed).slice(0, 40)}..." and the rendered text agrees`,
        `arm text "${armText.slice(0, 40)}...", rendered "${renderedText.slice(0, 40)}...", ` +
          `${nativeInsertions} native and ${handlerInsertions} handler insertion(s)`,
      ),
      this.deliveryProof(
        'typeText',
        inputs,
        `Event Timing entries during the gesture: ${eventTimingEntriesObserved ?? 'not observed'}`,
      ),
    ])

    this.assertDrivenFrameFloor('typeText', window, minDrivenFrames, durationMs)
    if (latencies.length < minLatencySamples) {
      this.abort(
        'typeText:sampleFloor',
        `at least ${minLatencySamples} dispatch-to-painted samples inside the measured window`,
        `${latencies.length} sample(s) from ${charsDispatched} dispatched character(s)`,
      )
    }

    return {
      proofs,
      window,
      inputs,
      dispatchToPaintedMs: latencies,
      charsDispatched,
      charsObserved,
      nativeInsertions,
      handlerInsertions,
      eventTimingEntriesObserved,
    }
  }

  /**
   * A typing target outside the arm's own subtree cannot be the arm's editor, and typing
   * into it would measure the driver rather than the arm.
   */
  private assertArmOwnsTarget(target: HTMLElement): void {
    const gestureTarget = this.arm.getGestureTarget()
    const transformTarget = this.arm.getTransformTarget()
    if (gestureTarget.contains(target)) return
    if (transformTarget?.contains(target) === true) return
    this.abort(
      'typeText:targetOwnership',
      "the typing target is inside the arm's own gesture or transform subtree",
      'the target is outside both, so it is not the arm\'s editor and typing into it would ' +
        'prove only that the driver can write to a DOM node',
    )
  }
}

export type { Tolerance } from './driver-geometry'
export type { PointerDispatchState } from './driver-events'
