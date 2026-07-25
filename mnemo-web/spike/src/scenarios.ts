/**
 * The eleven measured scenarios plus the control: for each one, where to point the camera,
 * what gesture to drive through it, and how many proofs that gesture owes.
 *
 * Three rules shape every plan in this file.
 *
 * A gating gesture is driven for a DURATION long enough to collect at least 200 driven
 * frames, roughly ten seconds of continuous motion. Below that the nearest-rank tail ranks
 * stop being distinct and p95, p99 and max become one observation printed three times.
 *
 * Every plan declares `minimumProofs` up front. The runner seals the ledger against that
 * number, so a scenario that skipped a gesture fails at the seal rather than reporting a
 * clean histogram nobody drove.
 *
 * A camera is never assumed to have landed where it was pointed. Every scenario proves the
 * arm accepted the viewport and that elements are actually on screen before it measures
 * anything, because a mispointed camera produces a flawless frame histogram of blank space.
 */

import type {
  ArmHandle,
  FrameSample,
  FrameStats,
  LatencyStats,
  Point,
  ScenarioId,
  ScenarioSpec,
  Viewport,
} from './harness/contract'
import type { Bounds, MindmapElement, MindmapFixture } from './fixture/model'
import { fitZoom } from './fixture/model'
import { computeRelayout, type FixtureRoles } from './fixture/generate'
import {
  DEFAULT_GATING_DURATION_MS,
  GestureDriver,
  ProofLedger,
  awaitFrames,
  buildProof,
  findZoomCrossings,
  worstFrameDtInWindow,
  type ZoomSample,
} from './harness/driver'
import {
  summarizeFrames,
  summarizeLatency,
  type EventTimingObserver,
  type FrameSampler,
} from './harness/measure'

// ---- shared constants ------------------------------------------------------------------

/** The fixture size the whole spike is about. `control` deliberately runs the same code at 100. */
export const FULL_ELEMENT_COUNT = 5000
export const CONTROL_ELEMENT_COUNT = 100

/**
 * Level-of-detail band edges. These are the shipped desktop's own thresholds, so every arm
 * implements the same two, and S5x is defined as the frames in which a sweep crosses them.
 */
const LABEL_ZOOM_THRESHOLD = 0.15
const CHROME_ZOOM_THRESHOLD = 0.4

/**
 * Screen-space pan speed. Fast enough that the camera genuinely traverses content rather
 * than nudging it, slow enough that a ten second window stays over the fixture instead of
 * panning off into blank space, which would measure an empty renderer.
 */
const PAN_SPEED_PX_PER_SECOND = 600

/**
 * Pan travel for the all-visible scenarios, as a fraction of the visible canvas. At the
 * dense grid's fit zoom the map is smaller than the viewport, so there is no room to pan
 * without pushing elements off the screen, and pushing them off is exactly what S4a must
 * not do: its whole premise is that culling is inert because everything is visible.
 */
const ALL_VISIBLE_PAN_TRAVEL_FRACTION = 0.05

/** S6's path length, from the scenario's own name in thresholds.json. */
const SINGLE_DRAG_PATH_PX = 400

/** S7's path length. Same source. */
const GROUP_DRAG_PATH_PX = 500

/** Elements marquee-selected alongside the 120-member frame in S7. */
const GROUP_DRAG_SELECTION_SIZE = 50

/** Tree nodes S9 spot-checks after the relayout. Enough to catch a partial commit. */
const RELAYOUT_PROOF_SAMPLE_SIZE = 64

/** Canvas units a relayout position may miss by and still count as applied. */
const RELAYOUT_POSITION_EPSILON = 0.01

/** Viewport agreement is one quantity read two ways, so this is near-equality, not tolerance. */
const VIEWPORT_EPSILON_PX = 0.5
const VIEWPORT_EPSILON_ZOOM = 0.001

/** Frames to let a setup write commit before it is read back. */
const SETUP_SETTLE_FRAMES = 3

// ---- specs -----------------------------------------------------------------------------

function makeSpec(
  id: ScenarioId,
  name: string,
  layout: ScenarioSpec['layout'],
  elementCount: number,
  lodEnabled: boolean,
  gating: boolean,
): ScenarioSpec {
  return { id, name, layout, elementCount, lodEnabled, gating }
}

/**
 * `gating` here mirrors thresholds.json but never decides anything: the verdict generator
 * reads the threshold file itself, so a divergence between the two shows up as a mislabelled
 * spec rather than as a scenario that quietly stopped gating.
 */
export const SCENARIO_SPECS: Readonly<Record<ScenarioId, ScenarioSpec>> = {
  S1: makeSpec('S1', 'Mount to interactive', 'forest', FULL_ELEMENT_COUNT, true, true),
  S2: makeSpec('S2', 'Pan at zoom 1.0', 'forest', FULL_ELEMENT_COUNT, true, true),
  S3: makeSpec('S3', 'Pan at the zoom floor 0.1', 'forest', FULL_ELEMENT_COUNT, true, true),
  S4a: makeSpec('S4a', 'Pan with every element visible, LOD on', 'dense-grid', FULL_ELEMENT_COUNT, true, true),
  S4b: makeSpec('S4b', 'Pan with every element visible, LOD off', 'dense-grid', FULL_ELEMENT_COUNT, false, false),
  S5: makeSpec('S5', 'Zoom sweep 0.1 to 1.0 to 0.1', 'forest', FULL_ELEMENT_COUNT, true, true),
  S5x: makeSpec('S5x', 'LOD threshold crossings inside the sweep', 'forest', FULL_ELEMENT_COUNT, true, true),
  S6: makeSpec('S6', 'Single-node drag', 'forest', FULL_ELEMENT_COUNT, true, true),
  S7: makeSpec(
    'S7',
    'Group drag: 120-member frame plus a 50-element selection',
    'forest',
    FULL_ELEMENT_COUNT,
    true,
    true,
  ),
  S8: makeSpec('S8', 'Inline label typing latency', 'dense-grid', FULL_ELEMENT_COUNT, true, true),
  S9: makeSpec('S9', 'Relayout: every node position changes in one commit', 'forest', FULL_ELEMENT_COUNT, true, true),
  control: makeSpec('control', 'Control: pan and drag at 100 elements', 'forest', CONTROL_ELEMENT_COUNT, true, true),
}

export function isScenarioId(value: string): value is ScenarioId {
  return Object.prototype.hasOwnProperty.call(SCENARIO_SPECS, value)
}

/**
 * Resolves a scenario id case-insensitively, because the ids mix case ('S1', 'S4a') and every
 * layer between a command line and this function is a chance for one of them to be folded.
 * A run launcher that lowercased the id once already turned every 5,000-element scenario into
 * a page that appeared never to load, so tolerance here is cheap insurance against a failure
 * whose symptom points nowhere near its cause.
 */
export function resolveScenarioId(value: string): ScenarioId | undefined {
  if (isScenarioId(value)) return value
  const folded = value.toLowerCase()
  return (Object.keys(SCENARIO_SPECS) as ScenarioId[]).find((id) => id.toLowerCase() === folded)
}

// ---- context and outcome ----------------------------------------------------------------

export interface ScenarioContext {
  readonly spec: ScenarioSpec
  readonly arm: ArmHandle
  readonly fixture: MindmapFixture
  readonly roles: FixtureRoles
  readonly driver: GestureDriver
  readonly ledger: ProofLedger
  readonly sampler: FrameSampler
  readonly win: Window
  readonly seed: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  /** Wall-clock cost of `ArmModule.mount`, measured by the runner, which is S1's whole metric. */
  readonly mountMs: number
  /** Worst animation-frame gap across the mount: the portable stand-in for a long task. */
  readonly mountLongestBlockMs: number
  /** Corroboration only. Synthetic dispatch produces no entries, and that is never an abort. */
  readonly eventTiming: EventTimingObserver
}

export interface ScenarioOutcome {
  readonly frames: FrameStats | null
  readonly latency: LatencyStats | null
  readonly scalars: Readonly<Record<string, number>>
}

export interface ViewportPlanInput {
  readonly fixture: MindmapFixture
  readonly roles: FixtureRoles
  readonly viewportWidth: number
  readonly viewportHeight: number
}

export interface ScenarioPlan {
  readonly spec: ScenarioSpec
  /**
   * Proofs this scenario's gestures owe the ledger, the two camera proofs included. Stated
   * here rather than counted afterwards so a gesture that never ran fails the seal instead of
   * reporting whatever the gestures that did run happened to prove.
   */
  readonly minimumProofs: number
  planViewport(input: ViewportPlanInput): Viewport
  /** Elements that must be on screen before the gesture may run. */
  requiredOnScreen(fixture: MindmapFixture): number
  run(ctx: ScenarioContext): Promise<ScenarioOutcome>
}

// ---- geometry helpers --------------------------------------------------------------------

function centreOf(bounds: Bounds): Point {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
}

/** Camera whose visible rect is centred on `centre`, in the contract's canvas-space convention. */
function cameraCentredOn(centre: Point, zoom: number, viewportWidth: number, viewportHeight: number): Viewport {
  return {
    x: centre.x - viewportWidth / (2 * zoom),
    y: centre.y - viewportHeight / (2 * zoom),
    zoom,
  }
}

function boundsOfElements(elements: readonly MindmapElement[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const element of elements) {
    minX = Math.min(minX, element.x)
    minY = Math.min(minY, element.y)
    maxX = Math.max(maxX, element.x + element.width)
    maxY = Math.max(maxY, element.y + element.height)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Canvas-space travel for one axis of a pan.
 *
 * When the content is larger than the view the travel is clamped so the camera never leaves
 * the fixture: a pan that ends over empty canvas stops measuring a loaded renderer partway
 * through the window it is being judged on. When the content is smaller than the view, which
 * is the dense grid at its fit zoom, there is no room at all, so the small all-visible travel
 * is used and the scenario accepts that a sliver of the map leaves the screen.
 */
function panTravelCanvas(
  span: number,
  viewCanvas: number,
  durationMs: number,
  zoom: number,
  keepAllVisible: boolean,
): number {
  if (keepAllVisible) return viewCanvas * ALL_VISIBLE_PAN_TRAVEL_FRACTION
  const desired = (PAN_SPEED_PX_PER_SECOND * (durationMs / 1000)) / zoom
  const room = Math.max(0, span - viewCanvas)
  return room === 0 ? viewCanvas * ALL_VISIBLE_PAN_TRAVEL_FRACTION : Math.min(desired, room)
}

interface PanPlan {
  readonly viewport: Viewport
  readonly dx: number
  readonly dy: number
}

/**
 * A pan that starts half its travel before the content centre and ends half past it, so the
 * measured window is symmetric about the densest part of the fixture rather than drifting off
 * one edge of it.
 */
function planPan(
  fixture: MindmapFixture,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  durationMs: number,
  keepAllVisible: boolean,
): PanPlan {
  const bounds = fixture.bounds
  const travelX = panTravelCanvas(
    bounds.maxX - bounds.minX,
    viewportWidth / zoom,
    durationMs,
    zoom,
    keepAllVisible,
  )
  const travelY = panTravelCanvas(
    bounds.maxY - bounds.minY,
    viewportHeight / zoom,
    durationMs,
    zoom,
    keepAllVisible,
  )
  // Anchored on the nearest real element rather than on the bounding box's centre. The forest
  // lays 20 clusters on a grid with wide gutters, so the geometric centre of the whole map is
  // usually empty space: a pan starting there measured a viewport with nothing in it, which is
  // a real number for the wrong scenario. "A comfortable view" has to mean looking at content.
  const geometricCentre = centreOf(bounds)
  const anchorElement = nearestElements(fixture, geometricCentre, () => true, 1)[0]
  const centre = anchorElement
    ? { x: anchorElement.x + anchorElement.width / 2, y: anchorElement.y + anchorElement.height / 2 }
    : geometricCentre

  const viewport = cameraCentredOn(
    { x: centre.x - travelX / 2, y: centre.y - travelY / 2 },
    zoom,
    viewportWidth,
    viewportHeight,
  )
  // Grab and pan: dragging the surface one way moves the camera the other, so the screen-space
  // delta is the negated canvas travel scaled back up by zoom.
  return { viewport, dx: -travelX * zoom, dy: -travelY * zoom }
}

function viewportCentreCanvas(viewport: Viewport, viewportWidth: number, viewportHeight: number): Point {
  return {
    x: viewport.x + viewportWidth / (2 * viewport.zoom),
    y: viewport.y + viewportHeight / (2 * viewport.zoom),
  }
}

function distanceFrom(element: MindmapElement, point: Point): number {
  return Math.hypot(element.x + element.width / 2 - point.x, element.y + element.height / 2 - point.y)
}

/** Elements nearest `point`, nearest first, so a gesture picks something actually on screen. */
function nearestElements(
  fixture: MindmapFixture,
  point: Point,
  keep: (element: MindmapElement) => boolean,
  count: number,
): readonly MindmapElement[] {
  return fixture.elements
    .filter(keep)
    .map((element) => ({ element, distance: distanceFrom(element, point) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((entry) => entry.element)
}

// ---- camera proofs -------------------------------------------------------------------------

function describeViewport(viewport: Viewport | null): string {
  return viewport
    ? `(${viewport.x.toFixed(2)}, ${viewport.y.toFixed(2)}, zoom ${viewport.zoom.toFixed(4)})`
    : 'null'
}

function viewportsAgree(a: Viewport, b: Viewport): boolean {
  return (
    Math.abs(a.x - b.x) <= VIEWPORT_EPSILON_PX &&
    Math.abs(a.y - b.y) <= VIEWPORT_EPSILON_PX &&
    Math.abs(a.zoom - b.zoom) <= VIEWPORT_EPSILON_ZOOM
  )
}

/**
 * Points the camera and proves it landed, in two dimensions that fail for different reasons.
 *
 * The first says the arm accepted the viewport and committed a transform that agrees with its
 * own state. The second says elements are genuinely on screen: an arm whose viewport
 * convention differs from the contract's accepts the numbers happily and then renders blank
 * space, and blank space produces the best frame histogram in the whole spike.
 */
export async function applyScenarioViewport(ctx: ScenarioContext, plan: ScenarioPlan): Promise<void> {
  const requested = plan.planViewport({
    fixture: ctx.fixture,
    roles: ctx.roles,
    viewportWidth: ctx.viewportWidth,
    viewportHeight: ctx.viewportHeight,
  })
  ctx.arm.setViewport(requested)
  ctx.arm.setLodEnabled(ctx.spec.lodEnabled)
  await awaitFrames(SETUP_SETTLE_FRAMES, ctx.win)

  const state = ctx.arm.getViewport()
  const committed = ctx.arm.readCommittedViewport()
  ctx.ledger.record(
    buildProof(
      'viewport:applied',
      viewportsAgree(requested, state),
      committed !== null && viewportsAgree(state, committed),
      `the arm's viewport becomes ${describeViewport(requested)} and its committed transform agrees`,
      `state ${describeViewport(state)}, committed ${describeViewport(committed)}`,
    ),
  )

  const onScreen = ctx.arm.getOnScreenCounts()
  const required = plan.requiredOnScreen(ctx.fixture)
  ctx.ledger.record(
    buildProof(
      'viewport:onScreen',
      onScreen.elements >= required,
      onScreen.domNodes > 0,
      `at least ${required} of ${ctx.fixture.elements.length} elements on screen at this camera, ` +
        'rendered into a non-empty subtree',
      `${onScreen.elements} element(s), ${onScreen.edges} edge(s), ${onScreen.domNodes} DOM node(s)`,
    ),
  )
}

// ---- frame readers ---------------------------------------------------------------------------

/**
 * Worst frame delta in a phase, or 0 when the phase recorded nothing. Only ever used for the
 * scalar block metrics: a "longest stall was 0ms because nothing was sampled" reading is
 * caught by the surrounding proof, never by this reader, so it must not be used as a gate on
 * its own.
 */
export function worstFrameDeltaMs(samples: readonly FrameSample[], phase: FrameSample['phase']): number {
  let worst = 0
  for (const sample of samples) {
    if (sample.phase === phase && sample.dt > worst) worst = sample.dt
  }
  return worst
}

function drivenFrames(ctx: ScenarioContext): FrameStats {
  return summarizeFrames(ctx.sampler.collect(), 'driven')
}

// ---- gesture building blocks -------------------------------------------------------------------

async function drivePan(ctx: ScenarioContext, keepAllVisible: boolean): Promise<void> {
  const { dx, dy } = planPan(
    ctx.fixture,
    ctx.arm.getViewport().zoom,
    ctx.viewportWidth,
    ctx.viewportHeight,
    DEFAULT_GATING_DURATION_MS,
    keepAllVisible,
  )
  await ctx.driver.pan({ dx, dy, durationMs: DEFAULT_GATING_DURATION_MS })
}

/** The node S6 and the control drag: an ordinary tree node, nearest the camera centre. */
function pickDragTarget(ctx: ScenarioContext): MindmapElement {
  const centre = viewportCentreCanvas(ctx.arm.getViewport(), ctx.viewportWidth, ctx.viewportHeight)
  const target = nearestElements(ctx.fixture, centre, (element) => element.kind === 'node', 1)[0]
  if (!target) throw new Error('the fixture contains no node-kind element to drag')
  return target
}

/**
 * True when the whole element, plus the room the drag path needs, sits inside the viewport.
 * A press computed for an element that is off screen lands on empty space or on the wrong
 * element, and the resulting gesture measures nothing while looking like an ordinary run.
 */
function isDraggableInView(ctx: ScenarioContext, element: MindmapElement): boolean {
  const viewport = ctx.arm.getViewport()
  const right = viewport.x + ctx.viewportWidth / viewport.zoom
  const bottom = viewport.y + ctx.viewportHeight / viewport.zoom
  return (
    element.x >= viewport.x &&
    element.y >= viewport.y &&
    element.x + element.width <= right &&
    element.y + element.height <= bottom
  )
}

async function driveSingleDrag(ctx: ScenarioContext): Promise<void> {
  let target = pickDragTarget(ctx)

  // A scenario may have panned before reaching here, and on a small fixture a long pan can
  // leave the camera off the content entirely, so the nearest node is still nowhere near the
  // screen. Re-pointing the camera at the target is setup rather than measurement, and it is
  // what keeps the drag a drag instead of a press on blank canvas.
  if (!isDraggableInView(ctx, target)) {
    const zoom = ctx.arm.getViewport().zoom
    const centre = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
    ctx.arm.setViewport(cameraCentredOn(centre, zoom, ctx.viewportWidth, ctx.viewportHeight))
    await awaitFrames(SETUP_SETTLE_FRAMES, ctx.win)
    target = pickDragTarget(ctx)
  }

  // The path length is the scenario's own 400px; the duration is what the 200-driven-frame
  // floor requires, so the gesture is slower than a real flick and every frame of it counts.
  await ctx.driver.dragElement({
    id: target.id,
    dx: SINGLE_DRAG_PATH_PX,
    dy: SINGLE_DRAG_PATH_PX / 2,
    durationMs: DEFAULT_GATING_DURATION_MS,
  })
}

// ---- plans ------------------------------------------------------------------------------------

type ViewportPlanner = (input: ViewportPlanInput) => Viewport

/** Camera on the content centre at a fixed zoom, for the scenarios that do not pan. */
function centredAt(zoom: number): ViewportPlanner {
  return (input) => cameraCentredOn(centreOf(input.fixture.bounds), zoom, input.viewportWidth, input.viewportHeight)
}

function panStartAt(zoom: number, keepAllVisible: boolean): ViewportPlanner {
  return (input) =>
    planPan(
      input.fixture,
      zoom,
      input.viewportWidth,
      input.viewportHeight,
      DEFAULT_GATING_DURATION_MS,
      keepAllVisible,
    ).viewport
}

/** The dense grid's whole point: the zoom at which every element is on screen at once. */
const denseGridFit: ViewportPlanner = (input) => {
  const { zoom } = fitZoom(input.fixture.bounds, input.viewportWidth, input.viewportHeight)
  return cameraCentredOn(centreOf(input.fixture.bounds), zoom, input.viewportWidth, input.viewportHeight)
}

function atLeastOne(): number {
  return 1
}

function everyElement(fixture: MindmapFixture): number {
  return fixture.elements.length
}

const S1_PLAN: ScenarioPlan = {
  spec: SCENARIO_SPECS.S1,
  minimumProofs: 2,
  planViewport: centredAt(1),
  requiredOnScreen: atLeastOne,
  run(ctx) {
    // The mount is over by the time any scenario runs, so S1 reports what the runner measured
    // around `ArmModule.mount` rather than driving a gesture of its own. `frames` stays null
    // deliberately: a handful of mount frames is not a distribution, and reporting it as one
    // would hold the verdict at 'warn' for a sample count this scenario never claimed.
    return Promise.resolve({
      frames: null,
      latency: null,
      scalars: { mountMs: ctx.mountMs, longestBlockMs: ctx.mountLongestBlockMs },
    })
  },
}

function makePanScenario(
  spec: ScenarioSpec,
  planViewport: ViewportPlanner,
  keepAllVisible: boolean,
): ScenarioPlan {
  return {
    spec,
    minimumProofs: 4, // the two camera proofs, plus pan's own state and delivery proofs
    planViewport,
    requiredOnScreen: keepAllVisible ? everyElement : atLeastOne,
    async run(ctx) {
      await drivePan(ctx, keepAllVisible)
      return { frames: drivenFrames(ctx), latency: null, scalars: {} }
    },
  }
}

const S2_PLAN = makePanScenario(SCENARIO_SPECS.S2, panStartAt(1, false), false)
const S3_PLAN = makePanScenario(SCENARIO_SPECS.S3, panStartAt(0.1, false), false)
const S4A_PLAN = makePanScenario(SCENARIO_SPECS.S4a, denseGridFit, true)
const S4B_PLAN = makePanScenario(SCENARIO_SPECS.S4b, denseGridFit, true)

const SWEEP_FROM = 0.1
const SWEEP_TO = 1.0
const LOD_THRESHOLDS: readonly number[] = [LABEL_ZOOM_THRESHOLD, CHROME_ZOOM_THRESHOLD]

async function driveZoomSweep(ctx: ScenarioContext): Promise<readonly ZoomSample[]> {
  const result = await ctx.driver.zoomSweep({
    from: SWEEP_FROM,
    to: SWEEP_TO,
    returnToStart: true,
    durationMs: DEFAULT_GATING_DURATION_MS,
  })
  return result.samples
}

const S5_PLAN: ScenarioPlan = {
  spec: SCENARIO_SPECS.S5,
  minimumProofs: 5, // the two camera proofs, plus the sweep's end-state, tracking and delivery proofs
  planViewport: centredAt(SWEEP_FROM),
  requiredOnScreen: atLeastOne,
  async run(ctx) {
    await driveZoomSweep(ctx)
    return { frames: drivenFrames(ctx), latency: null, scalars: {} }
  },
}

const S5X_PLAN: ScenarioPlan = {
  spec: SCENARIO_SPECS.S5x,
  minimumProofs: 6, // the sweep's five, plus a proof that the crossings were actually observed
  planViewport: centredAt(SWEEP_FROM),
  requiredOnScreen: atLeastOne,
  async run(ctx) {
    const samples = await driveZoomSweep(ctx)
    const crossings = findZoomCrossings(samples, LOD_THRESHOLDS)
    const frameSamples = ctx.sampler.collect()

    // A round trip crosses each band edge twice, once climbing and once descending. Fewer than
    // that means the sweep never reached a band edge, which would make any number reported here
    // a measurement of ordinary sweep frames wearing the label of a threshold crossing.
    const expectedCrossings = LOD_THRESHOLDS.length * 2
    const worstPerCrossing = crossings
      .map((crossing) => worstFrameDtInWindow(frameSamples, crossing.fromT, crossing.toT))
      .filter((worst): worst is number => worst !== null)

    ctx.ledger.record(
      buildProof(
        'zoomSweep:lodCrossings',
        crossings.length >= expectedCrossings,
        worstPerCrossing.length === crossings.length,
        `the sweep crosses zoom ${LOD_THRESHOLDS.join(' and ')} at least ${expectedCrossings} times, ` +
          'and a frame sample lands inside every crossing window',
        `${crossings.length} crossing(s) observed, ${worstPerCrossing.length} of them with a frame ` +
          `sample in window, over ${samples.length} driven zoom sample(s)`,
      ),
    )

    if (worstPerCrossing.length === 0) {
      throw new Error(
        'no LOD threshold crossing produced a frame sample, so worstFrameAtCrossingMs cannot be ' +
          'reported; the sweep either never reached a band edge or no frame landed in the window',
      )
    }

    return {
      frames: drivenFrames(ctx),
      latency: null,
      scalars: {
        // The worst single crossing, never an average across them: S5x asks whether any band
        // change hitched, and averaging four crossings hides the one that did.
        worstFrameAtCrossingMs: Math.max(...worstPerCrossing),
        lodCrossingsObserved: crossings.length,
      },
    }
  },
}

const S6_PLAN: ScenarioPlan = {
  spec: SCENARIO_SPECS.S6,
  minimumProofs: 4, // the two camera proofs, plus the drag's own state and delivery proofs
  planViewport: centredAt(1),
  requiredOnScreen: atLeastOne,
  async run(ctx) {
    await driveSingleDrag(ctx)
    return { frames: drivenFrames(ctx), latency: null, scalars: {} }
  },
}

const S7_ZOOM = 0.5

/** The frame S7 drags: 120 members, spatially local, so the group move is genuinely on screen. */
function groupDragFrame(fixture: MindmapFixture, roles: FixtureRoles): MindmapElement {
  const frameId = roles.groupDragFrameIds[0]
  if (!frameId) {
    throw new Error('the fixture declares no groupDragFrameIds, so S7 has no 120-member frame to drag')
  }
  const frame = fixture.elements.find((element) => element.id === frameId)
  if (!frame) throw new Error(`groupDragFrameIds names "${frameId}", which is not in the fixture`)
  return frame
}

function frameMemberIds(frame: MindmapElement): readonly string[] {
  if (frame.content.kind !== 'frame') {
    throw new Error(`element "${frame.id}" is not a frame, so it carries no membership list`)
  }
  return frame.content.childIds
}

const S7_PLAN: ScenarioPlan = {
  spec: SCENARIO_SPECS.S7,
  // The two camera proofs, the drag's state and delivery proofs, and the member delta-equality
  // proof that is the frame-membership correctness gate riding the same gesture.
  minimumProofs: 5,
  planViewport(input) {
    const frame = groupDragFrame(input.fixture, input.roles)
    const memberIds = new Set(frameMemberIds(frame))
    const group = input.fixture.elements.filter(
      (element) => element.id === frame.id || memberIds.has(element.id),
    )
    return cameraCentredOn(centreOf(boundsOfElements(group)), S7_ZOOM, input.viewportWidth, input.viewportHeight)
  },
  requiredOnScreen: atLeastOne,
  async run(ctx) {
    const frame = groupDragFrame(ctx.fixture, ctx.roles)
    const memberIds = frameMemberIds(frame)
    const excluded = new Set<string>([frame.id, ...memberIds])
    const centre = viewportCentreCanvas(ctx.arm.getViewport(), ctx.viewportWidth, ctx.viewportHeight)
    const marquee = nearestElements(
      ctx.fixture,
      centre,
      (element) => !excluded.has(element.id),
      GROUP_DRAG_SELECTION_SIZE,
    )

    // The frame goes into the selection with the marquee: dragging an unselected node is how a
    // renderer is told to discard the current selection, which would quietly turn S7 into S6
    // with extra setup.
    ctx.arm.setSelection([frame.id, ...marquee.map((element) => element.id)])
    await awaitFrames(SETUP_SETTLE_FRAMES, ctx.win)

    await ctx.driver.dragElement({
      id: frame.id,
      dx: GROUP_DRAG_PATH_PX,
      dy: GROUP_DRAG_PATH_PX / 2,
      memberIds,
      durationMs: DEFAULT_GATING_DURATION_MS,
    })

    return {
      frames: drivenFrames(ctx),
      latency: null,
      scalars: { groupDragMembers: memberIds.length, groupDragSelected: marquee.length },
    }
  },
}

/**
 * The editing surface S8 needs, which `ArmHandle` deliberately does not carry.
 *
 * Typing is the one gesture with no viewport to read back, so the only honest proof is against
 * the arm's OWN model text. Reading the DOM node the driver typed into proves nothing: under
 * native insertion the driver wrote those characters itself, so a completely dead page would
 * pass. An arm that wants to be measured on S8 implements both members; one that does not is
 * reported as unmeasurable rather than measured against the driver.
 */
export interface EditableArm {
  /** The element a real inline edit would type into, inside the arm's own subtree. */
  getEditorTarget(): HTMLElement
  /** The arm's own model text for that element. Never a read of the node the driver wrote to. */
  readEditorText(): string
}

function asEditableArm(arm: ArmHandle): EditableArm | null {
  const candidate = arm as unknown as Partial<EditableArm>
  return typeof candidate.getEditorTarget === 'function' && typeof candidate.readEditorText === 'function'
    ? (candidate as EditableArm)
    : null
}

/** Typed on repeat for the whole window, so the sample count comes from duration, not length. */
const S8_TYPED_TEXT = 'the quick brown fox '

const S8_PLAN: ScenarioPlan = {
  spec: SCENARIO_SPECS.S8,
  minimumProofs: 4, // the two camera proofs, plus typeText's own state and delivery proofs
  planViewport: centredAt(0.5),
  requiredOnScreen: atLeastOne,
  async run(ctx) {
    const editable = asEditableArm(ctx.arm)
    if (!editable) {
      ctx.ledger.record(
        buildProof(
          'typeText:editorCapability',
          false,
          false,
          `arm '${ctx.arm.id}' exposes getEditorTarget() and readEditorText(), so a keystroke can be ` +
            "proved against the arm's own model text",
          'the arm exposes neither, so the only text available to assert on is the text the driver ' +
            'itself inserted, and a dead page would pass',
        ),
      )
      throw new Error(
        `S8 cannot be measured on arm '${ctx.arm.id}': it exposes no inline editing surface, so ` +
          'dispatch-to-painted latency has nothing arm-owned to land in',
      )
    }

    const result = await ctx.driver.typeText({
      target: editable.getEditorTarget(),
      text: S8_TYPED_TEXT,
      readArmText: () => editable.readEditorText(),
      eventTimingEntryCount: () => ctx.eventTiming.entryCount(),
    })

    const latency = summarizeLatency(result.dispatchToPaintedMs)
    return {
      frames: drivenFrames(ctx),
      latency,
      scalars: {
        dispatchToPaintedP95: latency.p95,
        dispatchToPaintedP99: latency.p99,
        // The verdict refuses to certify percentiles whose sample count and drop count it
        // cannot see, so both ride alongside them rather than being left in the prose.
        dispatchToPaintedCount: latency.count,
        dispatchToPaintedTimeouts: result.charsDispatched - result.charsObserved,
        // Entries appearing at all under synthetic dispatch would itself be a finding. Their
        // absence is the expected reading and never a fail.
        eventTimingEntriesObserved: result.eventTimingEntriesObserved ?? 0,
      },
    }
  },
}

const S9_PLAN: ScenarioPlan = {
  spec: SCENARIO_SPECS.S9,
  minimumProofs: 3, // the two camera proofs, plus the relayout's own applied-positions proof
  planViewport: centredAt(1),
  requiredOnScreen: atLeastOne,
  async run(ctx) {
    // A different seed than the fixture's, so the packer genuinely rearranges rather than
    // reproducing the arrangement it already built, which would understate the real cost.
    const positions = computeRelayout(ctx.fixture, ctx.seed + 1)

    ctx.sampler.setPhase('driven')
    const startedAt = performance.now()
    await ctx.arm.applyRelayout(positions)
    const timeToPaintedMs = performance.now() - startedAt
    ctx.sampler.setPhase('settle')

    const stride = Math.max(1, Math.floor(positions.size / RELAYOUT_PROOF_SAMPLE_SIZE))
    const sampled = [...positions.entries()].filter((_entry, index) => index % stride === 0)
    const misplaced: string[] = []
    for (const [id, expected] of sampled) {
      const actual = ctx.arm.getElementPosition(id)
      if (
        !actual ||
        Math.abs(actual.x - expected.x) > RELAYOUT_POSITION_EPSILON ||
        Math.abs(actual.y - expected.y) > RELAYOUT_POSITION_EPSILON
      ) {
        misplaced.push(id)
      }
    }

    const onScreen = ctx.arm.getOnScreenCounts()
    const committed = ctx.arm.readCommittedViewport()
    ctx.ledger.record(
      buildProof(
        'applyRelayout',
        misplaced.length === 0,
        // The contract exposes no per-element committed reader, so the commit dimension here is
        // the weaker one actually available: the arm still paints content and still holds a
        // parseable transform after moving every node in a single commit.
        committed !== null && onScreen.elements > 0,
        `all ${sampled.length} sampled tree nodes report their new position, and the arm still ` +
          'renders content with a parseable committed transform',
        `${misplaced.length} sampled node(s) away from the requested position` +
          `${misplaced.length > 0 ? ` (first: ${misplaced.slice(0, 3).join(', ')})` : ''}; ` +
          `${onScreen.elements} element(s) on screen, committed ${describeViewport(committed)}`,
      ),
    )

    // `frames` stays null for the same reason as S1: a relayout is one commit, not a window,
    // and a handful of frames reported as a distribution would hold the verdict at 'warn'.
    return {
      frames: null,
      latency: null,
      scalars: {
        timeToPaintedMs,
        longestBlockMs: worstFrameDeltaMs(ctx.sampler.collect(), 'driven'),
        relayoutNodes: positions.size,
      },
    }
  },
}

const CONTROL_PLAN: ScenarioPlan = {
  spec: SCENARIO_SPECS.control,
  // The two camera proofs, plus a state and a delivery proof from each of the two gestures.
  minimumProofs: 6,
  planViewport: panStartAt(1, false),
  requiredOnScreen: atLeastOne,
  async run(ctx) {
    await drivePan(ctx, false)
    await driveSingleDrag(ctx)
    // The two gestures are pooled into one driven distribution on purpose: the control asks a
    // single question, whether this arm is built correctly at 100 elements, and its only
    // threshold is a p95 that both gestures have to clear together.
    return { frames: drivenFrames(ctx), latency: null, scalars: {} }
  },
}

export const SCENARIO_PLANS: Readonly<Record<ScenarioId, ScenarioPlan>> = {
  S1: S1_PLAN,
  S2: S2_PLAN,
  S3: S3_PLAN,
  S4a: S4A_PLAN,
  S4b: S4B_PLAN,
  S5: S5_PLAN,
  S5x: S5X_PLAN,
  S6: S6_PLAN,
  S7: S7_PLAN,
  S8: S8_PLAN,
  S9: S9_PLAN,
  control: CONTROL_PLAN,
}

/**
 * Canvas-space occupancy over the fixture, handed to the driver so a pan presses on empty
 * canvas instead of grabbing an element and recording a node drag under the label "pan".
 */
export function createOccupancyTest(fixture: MindmapFixture): (point: Point) => boolean {
  return (point) =>
    fixture.elements.some(
      (element) =>
        point.x >= element.x &&
        point.x <= element.x + element.width &&
        point.y >= element.y &&
        point.y <= element.y + element.height,
    )
}
