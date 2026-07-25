/**
 * The coordination point for the whole spike.
 *
 * Every arm implements `ArmHandle`, every scenario is driven through it, and every proof
 * of execution is asserted against it. That is what lets one driver and one measurement
 * pass judge React Flow, a hand-rolled DOM renderer and a canvas renderer on identical
 * terms, which is the only way the comparison means anything.
 */

import type { FixtureLayout, MindmapFixture } from '../fixture/model'

export type ArmId = 'a1-reactflow' | 'a2-dom' | 'a3-canvas'

export interface Viewport {
  /** Canvas-space coordinate at the viewport's top-left, matching the desktop camera's origin convention. */
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface OnScreenCounts {
  readonly elements: number
  readonly edges: number
  /** Live DOM descendants of the arm's own render root. The explanatory variable for a DOM arm. */
  readonly domNodes: number
}

/**
 * What every arm must expose so the driver can drive it and prove it was driven.
 *
 * The read-back methods exist because a synthetic gesture that silently fails produces a
 * beautiful idle frame histogram, and an idle histogram is indistinguishable from a fast
 * one unless something asserts the gesture actually landed.
 */
export interface ArmHandle {
  readonly id: ArmId

  /** The arm's own authoritative viewport state. */
  getViewport(): Viewport
  /** Sets the viewport directly, for scenario setup rather than for measurement. */
  setViewport(viewport: Viewport): void

  /** Absolute canvas position of an element, read from the arm's own state. */
  getElementPosition(id: string): Point | undefined

  /**
   * The element whose committed CSS transform (or canvas camera matrix) reflects the
   * viewport. Read separately from `getViewport` on purpose: comparing the two separates
   * "state updated but never committed" from "the event never reached the handler".
   */
  getTransformTarget(): HTMLElement | null
  /** Reads the committed transform as a viewport, or null if it cannot be parsed. */
  readCommittedViewport(): Viewport | null

  /** The DOM node a real gesture would start on. Never window, never document. */
  getGestureTarget(): HTMLElement

  /**
   * The DOM node that owns one element's drag, if the arm has one.
   *
   * Resolving the press point geometrically and asking the document what is there returns
   * whatever happens to be topmost, which on a dense canvas is regularly a neighbour, an edge
   * or a frame drawn over the target. The gesture then moves something real, so nothing looks
   * broken, and the measurement is attributed to the wrong element. An arm that knows which
   * node belongs to which id should say so. A canvas arm has no such node and returns null,
   * and the driver falls back to hit-testing.
   */
  getElementNode?(id: string): HTMLElement | null

  /** Level of detail is a product requirement, so every arm implements it and can force it off. */
  setLodEnabled(enabled: boolean): void
  isLodEnabled(): boolean

  getOnScreenCounts(): OnScreenCounts

  /** Selects elements, for the group-drag scenario. */
  setSelection(ids: readonly string[]): void

  /**
   * Replaces every element position at once, the relayout case. Returns a promise that
   * settles when the new positions have been painted, which is the number S9 gates on.
   */
  applyRelayout(positions: ReadonlyMap<string, Point>): Promise<void>

  /**
   * Op payload the arm would send at pointer-up, drained and cleared. The frame-membership
   * gate asserts on this rather than on a server round trip, which the spike does not do.
   */
  drainPendingOps(): readonly MoveOpLike[]

  dispose(): void
}

/** Shaped like the real `MoveOp` so the assertion transfers to the product code unchanged. */
export interface MoveOpLike {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface ArmMountArgs {
  readonly container: HTMLElement
  readonly fixture: MindmapFixture
  readonly initialViewport: Viewport
  readonly lodEnabled: boolean
  /** Set while a control measurement is running, so an arm can log which fixture it got. */
  readonly label: string
}

export interface ArmModule {
  readonly id: ArmId
  mount(args: ArmMountArgs): Promise<ArmHandle>
  /**
   * Mounts with an extra component rendered inside the arm's own tree. Exists for the
   * StrictMode probe: React scopes double-invocation to the tree StrictMode wraps, so a probe
   * mounted in a separate root can never say anything about the tree under measurement.
   * Optional, because a non-React arm has no tree to put it in and must report inconclusive.
   */
  mountWithProbe?(args: ArmMountArgs, probe: React.ReactNode): Promise<ArmHandle>
}

// ---- Scenarios ---------------------------------------------------------------------

export type ScenarioId =
  | 'S1'
  | 'S2'
  | 'S3'
  | 'S4a'
  | 'S4b'
  | 'S5'
  | 'S5x'
  | 'S6'
  | 'S7'
  | 'S8'
  | 'S9'
  | 'control'

export interface ScenarioSpec {
  readonly id: ScenarioId
  readonly name: string
  readonly layout: FixtureLayout
  /** Element count. The control scenario runs the same arm code at 100. */
  readonly elementCount: number
  readonly lodEnabled: boolean
  readonly gating: boolean
}

// ---- Measurement -------------------------------------------------------------------

/**
 * Frames are tagged by phase so a driven frame is never pooled with an idle one. Without
 * this an idle rAF heartbeat reads as a flawless 60fps run.
 */
export type FramePhase = 'warmup' | 'driven' | 'settle'

export interface FrameSample {
  readonly t: number
  readonly dt: number
  readonly phase: FramePhase
}

export interface FrameStats {
  /**
   * Which phase these numbers were computed over. Carried on the stats themselves because the
   * driven-versus-idle guarantee otherwise lives entirely in one argument at one call site, and
   * a `FrameStats` summarized from settle frames is indistinguishable from a driven one to
   * every consumer downstream of it.
   */
  readonly phase: FramePhase
  readonly count: number
  /**
   * True when `count` is too small for the tail percentiles to be distinct from `max`. At those
   * counts p95, p99 and max are the same observation printed three times, which reads as a
   * converged distribution rather than as a window nobody should be drawing a percentile from.
   */
  readonly degraded: boolean
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
  /** Reported separately and never pooled: 33.3ms coincides with WebKitGTK's idle floor. */
  readonly pctOver16_7: number
  readonly pctOver33_3: number
}

export interface LatencyStats {
  readonly count: number
  readonly p95: number
  readonly p99: number
  readonly max: number
}

/**
 * The achievable cadence on this machine right now, measured before every run by driving
 * a trivially cheap always-dirty animation. If the ceiling is 33ms, an absolute 60fps
 * threshold is unachievable by construction and the run is flagged rather than failed.
 */
export interface ClockCalibration {
  readonly medianFrameMs: number
  readonly impliedHz: number
  /**
   * `faster-than-60hz` is called out rather than folded into `60hz` because a 120Hz or 144Hz
   * ceiling makes an absolute 16.7ms bar trivially easy: an arm can miss every second deadline
   * and still clear it. The thresholds were written for a 60Hz panel, so a faster one is a fact
   * a reader has to see rather than a silently better result.
   */
  readonly regime: 'faster-than-60hz' | '60hz' | '30hz' | 'other'
}

/**
 * Tri-state on purpose. A probe that never reported is not a verified negative, and an
 * unverified StrictMode is exactly the confounder the check exists to catch: every render and
 * effect double-invoked, roughly double the per-frame work, reported as a clean measurement.
 */
export type StrictModeDetection = boolean | 'inconclusive'

export interface EnvironmentFacts {
  readonly userAgent: string
  readonly hardwareConcurrency: number
  readonly devicePixelRatio: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly isProductionBuild: boolean
  readonly strictModeDetected: StrictModeDetection
  /** Recorded, never gating: synthetic events produce no Event Timing entries, so S8 cannot use it. */
  readonly eventTimingAvailable: boolean
  readonly supportedEntryTypes: readonly string[]
  /** Read from WEBGL_debug_renderer_info, so hardware-vs-software is recorded, not guessed. */
  readonly rasterizer: string | null
  readonly contentVisibilitySupported: boolean
  /** Chromium only. Never load-bearing for a cross-engine verdict. */
  readonly heapUsedBytes: number | null
}

/**
 * How much a result may claim. The verdict generator refuses to emit pass/fail from a row
 * that is not `gating`, which is the mechanical guard against WSL numbers leaking into
 * the verdict.
 */
export type EngineFidelity = 'gating' | 'lead' | 'correctness-only'

export interface ProofOfExecution {
  readonly gesture: string
  /** Did the arm's own state change by the intended magnitude, not merely change at all. */
  readonly stateMatched: boolean
  /** Did the committed DOM transform agree with that state. */
  readonly committedMatched: boolean
  readonly expected: string
  readonly actual: string
}

export interface RunResult {
  readonly arm: ArmId
  readonly scenario: ScenarioId
  readonly fixtureLayout: FixtureLayout
  readonly fixtureDigest: string
  readonly elementCount: number
  readonly edgeCount: number
  readonly lodEnabled: boolean
  readonly viewport: Viewport
  /** Recorded, never assumed. A culling dodge is visible here rather than hidden in config. */
  readonly onScreen: OnScreenCounts
  readonly calibration: ClockCalibration
  readonly frames: FrameStats | null
  readonly latency: LatencyStats | null
  /** Scenario-specific scalars: mountMs, timeToPaintedMs, worstFrameAtCrossingMs. */
  readonly scalars: Readonly<Record<string, number>>
  readonly proofs: readonly ProofOfExecution[]
  /** Non-empty means the run is invalid and must not be reported as a measurement. */
  readonly aborts: readonly string[]
  readonly environment: EnvironmentFacts
  readonly engineFidelity: EngineFidelity
  readonly startedAt: number
  readonly durationMs: number
}

export type Verdict = 'pass' | 'warn' | 'fail' | 'not-gating' | 'aborted'

export interface ScenarioVerdict {
  readonly scenario: ScenarioId
  readonly verdict: Verdict
  readonly reasons: readonly string[]
}
