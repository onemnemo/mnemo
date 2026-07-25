// @vitest-environment jsdom

/**
 * These tests exercise the driver against a small in-memory `ArmHandle` built for this
 * file, wired to real DOM nodes and driven by a controllable `requestAnimationFrame`. That
 * combination is what jsdom can carry: real PointerEvent/WheelEvent/InputEvent
 * construction, dispatch, propagation and proof arithmetic are all exercised for real.
 * What jsdom cannot carry is layout (`getBoundingClientRect` on an unstyled node is always
 * zero, and `elementFromPoint` does not exist at all) or a real browser's pointer capture
 * retargeting, so those are noted at the point they matter rather than faked into looking
 * tested.
 *
 * The abort paths get as much attention as the happy paths, because every one of them
 * guards a way for a gesture to silently not happen while the frame histogram still looks
 * flawless.
 */

import { afterEach, describe, expect, it } from 'vitest'

import type {
  ArmHandle,
  ArmId,
  FramePhase,
  MoveOpLike,
  OnScreenCounts,
  Point,
  Viewport,
} from './contract'
import { GestureDriver, ProofLedger, type GestureDriverOptions } from './driver'

// ---- a controllable animation-frame clock, shared by the driver and the fake arm ----

interface FakeRaf {
  readonly win: Pick<Window, 'requestAnimationFrame'>
  /** Flushes every queued callback with a timestamp `dt` ms after the last flush. */
  tick: (dt?: number) => Promise<void>
}

/**
 * Enough turns for the driver's await chains (frame promise, gesture loop, gesture method)
 * to run to their next `requestAnimationFrame` registration before the next flush.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

function makeFakeRaf(): FakeRaf {
  let queue: FrameRequestCallback[] = []
  // Starting from the real performance clock, not 0, keeps this consistent with code that
  // reads `performance.now()` directly rather than through `win`.
  let now = performance.now()
  const win: Pick<Window, 'requestAnimationFrame'> = {
    requestAnimationFrame: (cb: FrameRequestCallback): number => {
      queue.push(cb)
      return queue.length
    },
  }
  async function tick(dt = 16.7): Promise<void> {
    now += dt
    const callbacks = queue
    queue = []
    for (const cb of callbacks) cb(now)
    await flushMicrotasks()
  }
  return { win, tick }
}

/** Ticks the fake clock until `promise` settles, then surfaces its value or its rejection. */
async function drive<T>(promise: Promise<T>, raf: FakeRaf, maxTicks = 3000): Promise<T> {
  let settled = false
  const mark = (): void => {
    settled = true
  }
  promise.then(mark, mark)
  for (let i = 0; i < maxTicks && !settled; i++) await raf.tick()
  return promise
}

// ---- a small in-memory ArmHandle, wired (or deliberately not) to real events ----

interface ElementBox extends Point {
  readonly width: number
  readonly height: number
}

interface FakeArmOptions {
  readonly win: Pick<Window, 'requestAnimationFrame'>
  /** false reproduces the exact bug this module exists to catch: nothing is listening. */
  readonly wireListeners?: boolean
  /** Which event family the arm binds, so the mouse-compatibility dispatch is exercised too. */
  readonly binding?: 'pointer' | 'mouse'
  /** false reproduces "state updated, never committed": viewport changes but the commit never lands. */
  readonly commitEnabled?: boolean
  /** Commits an x this far behind the state: the transform that never catches up. */
  readonly commitStaleBy?: number
  readonly elements?: ReadonlyMap<string, ElementBox>
  readonly frameMembers?: ReadonlyMap<string, readonly string[]>
  /** Extra drift injected into one member's move, to prove the delta-equality check checks. */
  readonly buggyMemberId?: string
  /** The dragged frame moves by this fraction of the cursor delta while members move fully. */
  readonly frameLagFactor?: number
  /** Member ops carry the pre-drag position: count-correct, coordinate-stale. */
  readonly staleMemberOps?: boolean
  /** Ignores every nth pointermove, the coalescing/dropping arm. */
  readonly ignoreEveryNthMove?: number
  /**
   * Answers the calibration probe and then processes only every nth wheel: the coalescing
   * arm that still converges on the target zoom because the driver re-aims every frame.
   */
  readonly coalesceWheelsAfterProbe?: number
  /** Applies the typed character to the arm's own model; false leaves the editor dead. */
  readonly wireEditor?: boolean
}

class FakeArmHandle implements ArmHandle {
  readonly id: ArmId = 'a2-dom'
  readonly root: HTMLElement
  readonly editor: HTMLElement

  private viewport: Viewport = { x: 0, y: 0, zoom: 1 }
  private committedViewport: Viewport | null = { x: 0, y: 0, zoom: 1 }
  private readonly positions: Map<string, Point>
  private readonly boxes: ReadonlyMap<string, ElementBox>
  private readonly frameMembers: ReadonlyMap<string, readonly string[]>
  private readonly buggyMemberId: string | undefined
  private readonly frameLagFactor: number
  private readonly staleMemberOps: boolean
  private readonly ignoreEveryNthMove: number
  private readonly coalesceWheelsAfterProbe: number
  private readonly win: Pick<Window, 'requestAnimationFrame'>
  private readonly commitEnabled: boolean
  private readonly commitStaleBy: number
  private pendingOps: MoveOpLike[] = []
  private movesSeen = 0
  private wheelsSeen = 0
  private lod = true
  private drag: { id: string; pointerId: number; lastCanvas: Point; origin: Point } | null = null
  private pan: { pointerId: number; lastClient: Point } | null = null
  private editorModel = ''

  constructor(options: FakeArmOptions) {
    this.win = options.win
    this.commitEnabled = options.commitEnabled ?? true
    this.commitStaleBy = options.commitStaleBy ?? 0
    this.coalesceWheelsAfterProbe = options.coalesceWheelsAfterProbe ?? 1
    this.boxes = options.elements ?? new Map()
    this.frameMembers = options.frameMembers ?? new Map()
    this.buggyMemberId = options.buggyMemberId
    this.frameLagFactor = options.frameLagFactor ?? 1
    this.staleMemberOps = options.staleMemberOps ?? false
    this.ignoreEveryNthMove = options.ignoreEveryNthMove ?? 0
    this.positions = new Map(Array.from(this.boxes.entries()).map(([id, box]) => [id, { x: box.x, y: box.y }]))

    this.root = document.createElement('div')
    // jsdom never lays anything out, so this stubs a believable 1600x900 viewport rect
    // deterministically rather than letting every gesture land at (0, 0).
    Object.defineProperty(this.root, 'clientWidth', { value: 1600, configurable: true })
    Object.defineProperty(this.root, 'clientHeight', { value: 900, configurable: true })
    this.root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    document.body.appendChild(this.root)

    this.editor = document.createElement('div')
    this.editor.setAttribute('contenteditable', 'true')
    this.root.appendChild(this.editor)

    if (options.wireListeners !== false) this.wireListeners(options.binding ?? 'pointer')
    if (options.wireEditor !== false) this.wireEditor()
  }

  private scheduleCommit(): void {
    if (!this.commitEnabled) return
    this.win.requestAnimationFrame(() => {
      this.committedViewport = { ...this.viewport, x: this.viewport.x - this.commitStaleBy }
    })
  }

  private clientToCanvas(clientX: number, clientY: number): Point {
    const rect = this.root.getBoundingClientRect()
    return {
      x: (clientX - rect.left) / this.viewport.zoom + this.viewport.x,
      y: (clientY - rect.top) / this.viewport.zoom + this.viewport.y,
    }
  }

  private hitTest(point: Point): string | null {
    for (const [id, box] of this.boxes) {
      if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) {
        return id
      }
    }
    return null
  }

  private moveBy(id: string, dx: number, dy: number): void {
    const pos = this.positions.get(id)
    if (pos) this.positions.set(id, { x: pos.x + dx * this.frameLagFactor, y: pos.y + dy * this.frameLagFactor })
    for (const memberId of this.frameMembers.get(id) ?? []) {
      const memberPos = this.positions.get(memberId)
      if (!memberPos) continue
      // The bug under test: one member gets a slightly different delta than the rest.
      const drift = memberId === this.buggyMemberId ? 1 : 0
      this.positions.set(memberId, { x: memberPos.x + dx + drift, y: memberPos.y + dy })
    }
  }

  private emitOp(id: string, at?: Point): void {
    const pos = at ?? this.positions.get(id)
    if (pos) this.pendingOps.push({ id, x: pos.x, y: pos.y })
  }

  private onPress(clientX: number, clientY: number, pointerId: number): void {
    const canvasPoint = this.clientToCanvas(clientX, clientY)
    const hit = this.hitTest(canvasPoint)
    if (hit) {
      const origin = this.positions.get(hit)
      this.drag = { id: hit, pointerId, lastCanvas: canvasPoint, origin: origin ? { ...origin } : { x: 0, y: 0 } }
    } else {
      this.pan = { pointerId, lastClient: { x: clientX, y: clientY } }
    }
  }

  private onMove(clientX: number, clientY: number, pointerId: number): void {
    this.movesSeen += 1
    if (this.ignoreEveryNthMove > 0 && this.movesSeen % this.ignoreEveryNthMove === 0) return

    if (this.pan && this.pan.pointerId === pointerId) {
      const dx = clientX - this.pan.lastClient.x
      const dy = clientY - this.pan.lastClient.y
      this.viewport = {
        x: this.viewport.x - dx / this.viewport.zoom,
        y: this.viewport.y - dy / this.viewport.zoom,
        zoom: this.viewport.zoom,
      }
      this.pan.lastClient = { x: clientX, y: clientY }
      this.scheduleCommit()
    } else if (this.drag && this.drag.pointerId === pointerId) {
      const canvasPoint = this.clientToCanvas(clientX, clientY)
      this.moveBy(this.drag.id, canvasPoint.x - this.drag.lastCanvas.x, canvasPoint.y - this.drag.lastCanvas.y)
      this.drag.lastCanvas = canvasPoint
    }
  }

  private onRelease(pointerId: number): void {
    if (this.pan && this.pan.pointerId === pointerId) {
      this.pan = null
    } else if (this.drag && this.drag.pointerId === pointerId) {
      this.emitOp(this.drag.id)
      for (const memberId of this.frameMembers.get(this.drag.id) ?? []) {
        // A stale op carries the position the member had before the drag, which is exactly
        // the "op serialized from pre-drag state" bug a count-only check cannot see.
        this.emitOp(memberId, this.staleMemberOps ? this.startPositionOf(memberId) : undefined)
      }
      this.drag = null
    }
  }

  private startPositionOf(memberId: string): Point | undefined {
    const box = this.boxes.get(memberId)
    return box ? { x: box.x, y: box.y } : undefined
  }

  private wireListeners(binding: 'pointer' | 'mouse'): void {
    if (binding === 'pointer') {
      this.root.addEventListener('pointerdown', (e) => {
        const pe = e as PointerEvent
        this.onPress(pe.clientX, pe.clientY, pe.pointerId)
      })
      this.root.addEventListener('pointermove', (e) => {
        const pe = e as PointerEvent
        this.onMove(pe.clientX, pe.clientY, pe.pointerId)
      })
      this.root.addEventListener('pointerup', (e) => this.onRelease((e as PointerEvent).pointerId))
    } else {
      // d3-drag and d3-zoom, which React Flow's pan and node drag are built on, bind mouse
      // events rather than pointer events. Such an arm sees nothing from a pointer-only driver.
      this.root.addEventListener('mousedown', (e) => {
        const me = e as MouseEvent
        this.onPress(me.clientX, me.clientY, 0)
      })
      this.root.addEventListener('mousemove', (e) => {
        const me = e as MouseEvent
        this.onMove(me.clientX, me.clientY, 0)
      })
      this.root.addEventListener('mouseup', () => this.onRelease(0))
    }

    this.root.addEventListener('wheel', (e) => {
      this.wheelsSeen += 1
      const isProbe = this.wheelsSeen === 1
      if (!isProbe && this.wheelsSeen % this.coalesceWheelsAfterProbe !== 0) return
      const we = e as WheelEvent
      const sensitivity = 0.0021 // deliberately not the driver's own probe constant
      this.viewport = { ...this.viewport, zoom: this.viewport.zoom * Math.exp(-sensitivity * we.deltaY) }
      this.scheduleCommit()
    })
  }

  /** The arm owns insertion, and lands it on the next frame, so latency is a real interval. */
  private wireEditor(): void {
    this.editor.addEventListener('beforeinput', (e) => {
      e.preventDefault()
      const data = (e as InputEvent).data ?? ''
      this.win.requestAnimationFrame(() => {
        this.editorModel += data
        this.editor.textContent = this.editorModel
      })
    })
  }

  armText(): string {
    return this.editorModel
  }

  getViewport(): Viewport {
    return this.viewport
  }
  setViewport(viewport: Viewport): void {
    this.viewport = viewport
    this.committedViewport = { ...viewport }
  }
  getElementPosition(id: string): Point | undefined {
    return this.positions.get(id)
  }
  getTransformTarget(): HTMLElement | null {
    return this.root
  }
  readCommittedViewport(): Viewport | null {
    return this.committedViewport
  }
  getGestureTarget(): HTMLElement {
    return this.root
  }
  setLodEnabled(enabled: boolean): void {
    this.lod = enabled
  }
  isLodEnabled(): boolean {
    return this.lod
  }
  getOnScreenCounts(): OnScreenCounts {
    return { elements: this.boxes.size, edges: 0, domNodes: this.root.childElementCount }
  }
  setSelection(): void {
    // not exercised by these tests
  }
  async applyRelayout(positions: ReadonlyMap<string, Point>): Promise<void> {
    for (const [id, point] of positions) this.positions.set(id, point)
  }
  drainPendingOps(): readonly MoveOpLike[] {
    const ops = this.pendingOps
    this.pendingOps = []
    return ops
  }
  dispose(): void {
    this.root.remove()
  }
}

/**
 * Positions accumulate one increment per frame, so the last bits depend on where the fake
 * clock happened to start. The driver's own member-equality check allows the same
 * floating-point slack and nothing wider.
 */
function expectPosition(actual: Point | undefined, expected: Point): void {
  expect(actual).toBeDefined()
  expect(actual?.x).toBeCloseTo(expected.x, 6)
  expect(actual?.y).toBeCloseTo(expected.y, 6)
}

interface Rig {
  readonly arm: FakeArmHandle
  readonly driver: GestureDriver
  readonly ledger: ProofLedger
  readonly raf: FakeRaf
  readonly phases: FramePhase[]
}

type ExtraDriverOptions = Omit<GestureDriverOptions, 'ledger' | 'win' | 'setPhase'>

function rig(options: Omit<FakeArmOptions, 'win'> = {}, driverOptions: ExtraDriverOptions = {}): Rig {
  const raf = makeFakeRaf()
  const arm = new FakeArmHandle({ ...options, win: raf.win })
  const ledger = new ProofLedger()
  const phases: FramePhase[] = []
  const driver = new GestureDriver(arm, {
    ledger,
    win: raf.win as unknown as Window,
    setPhase: (phase) => phases.push(phase),
    ...driverOptions,
  })
  return { arm, driver, ledger, raf, phases }
}

/** Short windows keep the fake clock cheap; the frame floor is exercised on its own below. */
const SHORT: { durationMs: number; warmupMs: number; minDrivenFrames: number } = {
  durationMs: 120,
  warmupMs: 0,
  minDrivenFrames: 3,
}

afterEach(() => {
  document.body.replaceChildren()
})

// ---- pan --------------------------------------------------------------------------

describe('GestureDriver.pan', () => {
  it('proves execution against a correctly wired arm: state changes and the commit agrees', async () => {
    const { arm, driver, raf } = rig()
    const result = await drive(driver.pan({ dx: 200, dy: -60, ...SHORT }), raf)

    const proof = result.proofs[0]
    expect(proof.gesture).toBe('pan')
    expect(proof.stateMatched).toBe(true)
    expect(proof.committedMatched).toBe(true)
    // "grab and pan": dragging right/up moves the camera left/down.
    expect(arm.getViewport().x).toBeLessThan(0)
    expect(arm.getViewport().y).toBeGreaterThan(0)
  })

  it('drives one pointermove per frame for the requested duration, not one per step', async () => {
    const { driver, raf } = rig()
    // 10s at the fake clock's 16.7ms cadence is ~600 frames, which is what makes p95, p99
    // and max three different numbers instead of the same single observation.
    const result = await drive(
      driver.pan({ dx: 400, dy: 0, durationMs: 10_000, warmupMs: 500 }),
      raf,
      1200,
    )

    expect(result.window.drivenFrames).toBeGreaterThanOrEqual(200)
    expect(result.inputs.dispatched).toBe(result.window.frames)
    expect(result.window.drivenStartedAt).toBeGreaterThan(result.window.startedAt)
  })

  it('aborts rather than reporting percentiles over a window too short to have any', async () => {
    const { driver, raf, ledger } = rig()
    await expect(
      drive(driver.pan({ dx: 100, dy: 0, durationMs: 50, warmupMs: 0, minDrivenFrames: 200 }), raf),
    ).rejects.toThrow(/sampleFloor/)

    // The gesture's own proofs are recorded before the abort, so the ledger still says what
    // the pan did; the abort is the last thing to happen, not the thing that discards it.
    expect(ledger.seal(3).map((p) => p.gesture)).toEqual(['pan', 'pan:inputDelivery', 'pan:sampleFloor'])
  })

  it('finds an empty press point when the container centre is over an element', async () => {
    const centreCovered = new Map([['n1', { x: 700, y: 400, width: 200, height: 100 }]])
    const { arm, driver, raf } = rig({ elements: centreCovered })

    const result = await drive(driver.pan({ dx: 150, dy: 0, ...SHORT }), raf)

    expect(result.pressCandidatesRejected).toBeGreaterThan(0)
    expect(result.pressPoint).not.toEqual({ x: 800, y: 450 })
    expect(result.proofs[0].stateMatched).toBe(true)
    // The rejected candidate pressed on the element: the probe walks itself back, so the
    // element it grabbed is left exactly where it started.
    expectPosition(arm.getElementPosition('n1'), { x: 700, y: 400 })
  })

  it('aborts when no press point pans, instead of measuring a node drag labelled "pan"', async () => {
    const { driver, raf, ledger } = rig({ wireListeners: false })
    await expect(drive(driver.pan({ dx: 300, dy: 0, ...SHORT }), raf)).rejects.toThrow(
      /failed to move the viewport/,
    )
    expect(ledger.failures().some((p) => p.gesture === 'pan:pressPoint')).toBe(true)
  })

  it('catches state updated but never committed, separately from state not changing at all', async () => {
    const { driver, raf } = rig({ commitEnabled: false })
    const result = await drive(driver.pan({ dx: 300, dy: 0, ...SHORT }), raf)

    expect(result.proofs[0].stateMatched).toBe(true) // the arm's own state really did move
    expect(result.proofs[0].committedMatched).toBe(false) // but nothing ever committed it
  })

  it('fails the commit check on a transform that is permanently one gesture step behind', async () => {
    // 16.67 canvas units is one step of a 200px twelve-step pan, and used to pass: 15% of
    // 200 is 30 units of slack. State versus committed is one quantity read two ways, so it
    // is a near-equality check and this is the "state updated, never committed" class.
    const { driver, raf } = rig({ commitStaleBy: 16.67 })
    const result = await drive(driver.pan({ dx: 200, dy: 0, ...SHORT }), raf)

    expect(result.proofs[0].stateMatched).toBe(true)
    expect(result.proofs[0].committedMatched).toBe(false)
  })

  it('reports a coalescing arm as a responsiveness reading, not as a failure to deliver', async () => {
    const { driver, raf } = rig({ ignoreEveryNthMove: 3 })
    const result = await drive(driver.pan({ dx: 300, dy: 0, ...SHORT }), raf)

    const delivery = result.proofs[1]
    expect(delivery.gesture).toBe('pan:inputDelivery')
    expect(result.inputs.observed).toBeLessThan(result.inputs.dispatched)

    // Inputs are dispatched synchronously into synchronous handlers, so an arm whose state
    // advanced at all did receive them; what varies is whether it had committed by the time
    // the next frame read it. Gating on that ratio would report a slow arm as an undriven one
    // and hide the frame statistics that are the actual finding behind an aborted run.
    expect(delivery.stateMatched).toBe(true)
    expect(delivery.actual).toMatch(/responsiveness reading/)
    expect(delivery.actual).toMatch(/\d+ of \d+ dispatches/)
    expect(result.proofs[0].stateMatched).toBe(true)
  })

  it('still fails delivery for an arm that never advances at all', async () => {
    // The proposition the proof exists for: nothing arrived. An arm that ignores every move
    // observes zero, which no amount of load can explain away.
    const { driver, raf } = rig({ ignoreEveryNthMove: 1 })
    await expect(drive(driver.pan({ dx: 300, dy: 0, ...SHORT }), raf)).rejects.toThrow()
  })

  it('reaches an arm bound through mouse events, which a pointer-only driver never would', async () => {
    const { arm, driver, raf } = rig({ binding: 'mouse' })
    const result = await drive(driver.pan({ dx: 200, dy: 0, ...SHORT }), raf)
    expect(result.proofs[0].stateMatched).toBe(true)
    expect(arm.getViewport().x).toBeLessThan(0)
  })

  it('with mouse compatibility off, a mouse-bound arm is provably not driven', async () => {
    const { driver, raf } = rig({ binding: 'mouse' }, { mouseCompat: false })
    await expect(drive(driver.pan({ dx: 200, dy: 0, ...SHORT }), raf)).rejects.toThrow(
      /failed to move the viewport/,
    )
  })

  it('a magnitude mismatch fails even when the arm reacted, if the driver expected a different convention', async () => {
    const { arm, driver, raf } = rig({}, { panDeltaToViewportDelta: () => ({ x: 0, y: 0 }) })
    const result = await drive(driver.pan({ dx: 300, dy: 0, ...SHORT }), raf)

    // The arm genuinely moved; the proof still fails because the magnitude does not match
    // what was expected, proving this checks magnitude and not mere change.
    expect(arm.getViewport().x).not.toBe(0)
    expect(result.proofs[0].stateMatched).toBe(false)
  })

  it('holds the press-point search in warmup and only then opens the driven window', async () => {
    const { driver, raf, phases } = rig()
    await drive(driver.pan({ dx: 120, dy: 0, durationMs: 120, warmupMs: 60, minDrivenFrames: 2 }), raf)

    expect(phases[0]).toBe('warmup')
    expect(phases.indexOf('driven')).toBeGreaterThan(0)
    expect(phases[phases.length - 1]).toBe('settle')
  })
})

// ---- zoomSweep --------------------------------------------------------------------

describe('GestureDriver.zoomSweep', () => {
  it('self-calibrates against an unknown wheel sensitivity and lands near the target zoom', async () => {
    const { arm, driver, raf } = rig()
    const result = await drive(driver.zoomSweep({ from: 0.2, to: 0.8, ...SHORT }), raf)

    expect(result.proofs[0].stateMatched).toBe(true)
    expect(result.proofs[0].committedMatched).toBe(true)
    expect(arm.getViewport().zoom).toBeCloseTo(0.8, 1)
    expect(result.wheelSensitivity).toBeGreaterThan(0)
  })

  it('emits absolute sample timestamps inside the driven window, so they join to frame samples', async () => {
    const { driver, raf } = rig()
    const result = await drive(
      driver.zoomSweep({ from: 0.2, to: 0.8, durationMs: 200, warmupMs: 60, minDrivenFrames: 3 }),
      raf,
    )

    expect(result.samples.length).toBeGreaterThan(0)
    for (const sample of result.samples) {
      expect(sample.t).toBeGreaterThanOrEqual(result.window.drivenStartedAt)
      expect(sample.t).toBeLessThanOrEqual(result.window.endedAt)
    }
    // Monotonic across a one-directional sweep, so findZoomCrossings can be handed these directly.
    for (let i = 1; i < result.samples.length; i++) {
      expect(result.samples[i].zoom).toBeGreaterThanOrEqual(result.samples[i - 1].zoom - 1e-9)
    }
  })

  it('keeps the calibration probe and both viewport resets out of the driven window', async () => {
    const { arm, driver, raf, phases } = rig()
    const wheelsByPhase: FramePhase[] = []
    // Every wheel the arm sees is stamped with the phase current at that moment, which is
    // what proves the probe's own expensive frames are not pooled with the measured ones.
    arm.root.addEventListener('wheel', () => wheelsByPhase.push(phases[phases.length - 1] ?? 'warmup'))

    await drive(
      driver.zoomSweep({ from: 0.2, to: 0.8, durationMs: 120, warmupMs: 60, minDrivenFrames: 2 }),
      raf,
    )

    expect(wheelsByPhase[0]).toBe('warmup') // the sensitivity probe
    expect(wheelsByPhase).toContain('driven')
  })

  it('aborts on a sensitivity probe the arm never answered, rather than sweeping blind', async () => {
    const { driver, raf, ledger } = rig({ wireListeners: false })
    await expect(drive(driver.zoomSweep({ from: 0.2, to: 0.8, ...SHORT }), raf)).rejects.toThrow(
      /did not react to the probe/,
    )
    const failed = ledger.failures()
    expect(failed).toHaveLength(1)
    expect(failed[0].gesture).toBe('zoomSweep:sensitivityProbe')
  })

  it('sweeps out and back in one driven window when asked, so both LOD crossings are in it', async () => {
    const { arm, driver, raf } = rig()
    const result = await drive(
      driver.zoomSweep({ from: 0.2, to: 0.8, returnToStart: true, durationMs: 400, warmupMs: 0, minDrivenFrames: 5 }),
      raf,
    )

    const zooms = result.samples.map((sample) => sample.zoom)
    expect(Math.max(...zooms)).toBeGreaterThan(0.6)
    expect(arm.getViewport().zoom).toBeCloseTo(0.2, 1)
    expect(result.proofs[0].stateMatched).toBe(true)
  })

  it('reports a wheel-coalescing arm that converges quietly on the target zoom anyway', async () => {
    // Every step is re-aimed from the observed zoom, so an arm that processes half the
    // wheel events still lands on the target and the end-state check alone stays green.
    // The arm-side delivery count is what sees it.
    const { arm, driver, raf } = rig({ coalesceWheelsAfterProbe: 2 })
    const result = await drive(
      driver.zoomSweep({ from: 0.2, to: 0.8, durationMs: 800, warmupMs: 0, minDrivenFrames: 10 }),
      raf,
      200,
    )

    expect(arm.getViewport().zoom).toBeCloseTo(0.8, 1) // it did converge
    expect(result.proofs[0].stateMatched).toBe(true) // so the end-state proof is green
    const delivery = result.proofs[2]
    expect(delivery.gesture).toBe('zoomSweep:inputDelivery')
    // Surfaced as a number rather than as a failure: the arm plainly received the wheels, it
    // just did not settle between every pair of them, and that is a responsiveness reading.
    expect(result.inputs.observed).toBeLessThan(result.inputs.dispatched)
    expect(delivery.actual).toMatch(/responsiveness reading/)
  })

  it('fails the tracking proof when the arm lags the schedule by more than the tolerance', async () => {
    // Coarse coalescing over a short sweep leaves the observed zoom whole steps behind the
    // interpolated schedule, which is the degenerate "one or two large jumps" sweep.
    const { driver, raf } = rig({ coalesceWheelsAfterProbe: 5 })
    const result = await drive(driver.zoomSweep({ from: 0.2, to: 0.8, ...SHORT }), raf)

    expect(result.proofs[1].gesture).toBe('zoomSweep:tracking')
    expect(result.proofs[1].stateMatched).toBe(false)
  })

  it('tracks the interpolated schedule every frame against a healthy arm', async () => {
    const { driver, raf } = rig()
    const result = await drive(
      driver.zoomSweep({ from: 0.2, to: 0.8, durationMs: 400, warmupMs: 0, minDrivenFrames: 5 }),
      raf,
    )

    expect(result.proofs[1].gesture).toBe('zoomSweep:tracking')
    expect(result.proofs[1].stateMatched).toBe(true)
    expect(result.proofs[1].committedMatched).toBe(true)
  })
})

// ---- dragElement --------------------------------------------------------------------

function elements(): Map<string, ElementBox> {
  return new Map([
    ['n1', { x: 100, y: 100, width: 132, height: 40 }],
    ['m1', { x: 400, y: 400, width: 132, height: 40 }],
    ['m2', { x: 600, y: 420, width: 132, height: 40 }],
    ['m3', { x: 900, y: 100, width: 132, height: 40 }],
  ])
}

describe('GestureDriver.dragElement', () => {
  it('proves a single-node drag: position moves and one matching MoveOp is drained at pointer-up', async () => {
    const { arm, driver, raf } = rig({ elements: elements() })
    const result = await drive(driver.dragElement({ id: 'n1', dx: 120, dy: 40, ...SHORT }), raf)

    expect(result.proofs[0].stateMatched).toBe(true)
    expect(result.proofs[0].committedMatched).toBe(true)
    expectPosition(arm.getElementPosition('n1'), { x: 220, y: 140 })
  })

  it('catches a drag that never reaches the handler: no state change, no drained op', async () => {
    const { driver, raf } = rig({ elements: elements(), wireListeners: false })
    const result = await drive(driver.dragElement({ id: 'n1', dx: 120, dy: 40, ...SHORT }), raf)

    expect(result.proofs[0].stateMatched).toBe(false)
    expect(result.proofs[0].committedMatched).toBe(false)
    expect(result.proofs[1].stateMatched).toBe(false) // nothing was observed either
  })

  it('throws for an unknown element id rather than silently doing nothing', async () => {
    const { driver, raf } = rig({ elements: elements() })
    await expect(drive(driver.dragElement({ id: 'nope', dx: 10, dy: 10, ...SHORT }), raf)).rejects.toThrow(
      /unknown element id/,
    )
  })

  describe('frame-membership evidence (memberIds)', () => {
    const frameMembers = new Map([['n1', ['m1', 'm2', 'm3']]])
    const memberIds = ['m1', 'm2', 'm3']

    it('passes when every member moves by the identical delta and emits one matching MoveOp each', async () => {
      const { arm, driver, raf } = rig({ elements: elements(), frameMembers })
      const result = await drive(
        driver.dragElement({ id: 'n1', dx: 500, dy: -80, memberIds, ...SHORT }),
        raf,
      )

      expect(result.proofs).toHaveLength(3)
      const memberProof = result.proofs[2]
      expect(memberProof.gesture).toContain('memberDeltaEquality')
      expect(memberProof.stateMatched).toBe(true)
      expect(memberProof.committedMatched).toBe(true)
      // No cumulative drift over the path: same delta as the frame itself, exactly.
      expectPosition(arm.getElementPosition('m1'), { x: 900, y: 320 })
      expectPosition(arm.getElementPosition('m2'), { x: 1100, y: 340 })
      expectPosition(arm.getElementPosition('m3'), { x: 1400, y: 20 })
    })

    it('fails when one member drifts from the others, catching the F1/F4 bug this proof exists for', async () => {
      const { driver, raf } = rig({ elements: elements(), frameMembers, buggyMemberId: 'm2' })
      const result = await drive(
        driver.dragElement({ id: 'n1', dx: 500, dy: -80, memberIds, ...SHORT }),
        raf,
      )

      // The frame's own drag still proves out fine; only the membership evidence catches it.
      expect(result.proofs[0].stateMatched).toBe(true)
      const memberProof = result.proofs[2]
      expect(memberProof.stateMatched).toBe(false)
      expect(memberProof.actual).toContain('m2')
    })

    it('fails when the frame lags its members, which comparing both against intent would miss', async () => {
      // The frame moves 92% of the cursor delta and the members move all of it. Against the
      // driver's intent at 15% tolerance the frame passes and the members pass, and the
      // divergence between them, which is the actual defect, goes unreported.
      const { driver, raf } = rig({ elements: elements(), frameMembers, frameLagFactor: 0.92 })
      const result = await drive(
        driver.dragElement({ id: 'n1', dx: 500, dy: -80, memberIds, ...SHORT }),
        raf,
      )

      expect(result.proofs[0].stateMatched).toBe(true) // still inside the intent tolerance
      expect(result.proofs[2].stateMatched).toBe(false) // but not equal to the achieved delta
    })

    it('fails on count-correct but coordinate-stale member ops', async () => {
      const { driver, raf } = rig({ elements: elements(), frameMembers, staleMemberOps: true })
      const result = await drive(
        driver.dragElement({ id: 'n1', dx: 500, dy: -80, memberIds, ...SHORT }),
        raf,
      )

      const memberProof = result.proofs[2]
      expect(memberProof.stateMatched).toBe(true) // the elements really did move together
      expect(memberProof.committedMatched).toBe(false) // the payload carries pre-drag positions
      expect(memberProof.actual).toContain('should be')
    })

    it('throws for an unknown member id up front, rather than excluding it from the assertion', async () => {
      const { driver, raf } = rig({ elements: elements(), frameMembers })
      await expect(
        drive(driver.dragElement({ id: 'n1', dx: 10, dy: 10, memberIds: ['m1', 'ghost'], ...SHORT }), raf),
      ).rejects.toThrow(/unknown member id/)
    })
  })
})

// ---- typeText -----------------------------------------------------------------------

const TYPING: { durationMs: number; warmupMs: number; minDrivenFrames: number; perCharMs: number } = {
  durationMs: 300,
  warmupMs: 0,
  minDrivenFrames: 3,
  perCharMs: 16,
}

describe('GestureDriver.typeText', () => {
  it('measures dispatch-to-painted against the arm\'s own state and proves the text landed', async () => {
    const { arm, driver, raf } = rig()
    const result = await drive(
      driver.typeText({
        target: arm.editor,
        text: 'abc',
        readArmText: () => arm.armText(),
        minLatencySamples: 3,
        ...TYPING,
      }),
      raf,
    )

    expect(result.proofs[0].stateMatched).toBe(true)
    expect(result.proofs[0].committedMatched).toBe(true)
    expect(result.dispatchToPaintedMs.length).toBeGreaterThanOrEqual(3)
    // One frame of the fake clock: the frame the arm's state already carries the character
    // in is the frame that paints it.
    expect(Math.max(...result.dispatchToPaintedMs)).toBeLessThanOrEqual(50)
    expect(result.handlerInsertions).toBe(result.charsDispatched)
    expect(arm.armText().length).toBe(result.charsDispatched)
  })

  it('fails against a dead editor even though the driver itself inserted the characters', async () => {
    // The blocker case: with `beforeinput` unclaimed the driver performs the native
    // insertion, so a proof read back off that node would be the driver asserting against
    // itself. Against the arm's own model, a dead page fails.
    const { arm, driver, raf } = rig({ wireEditor: false })
    const result = await drive(
      driver.typeText({
        target: arm.editor,
        text: 'abc',
        readArmText: () => arm.armText(),
        minLatencySamples: 0,
        maxFramesPerChar: 2,
        ...TYPING,
      }),
      raf,
    )

    expect(arm.editor.textContent).not.toBe('') // the driver did write the DOM
    expect(result.nativeInsertions).toBeGreaterThan(0)
    expect(result.charsObserved).toBe(0)
    expect(result.proofs[0].stateMatched).toBe(false)
    expect(result.proofs[0].committedMatched).toBe(false)
    expect(result.proofs[1].stateMatched).toBe(false)
  })

  it('refuses a typing target outside the arm, which would prove only that the driver can write to a node', async () => {
    const { arm, driver, raf, ledger } = rig()
    const stray = document.createElement('div')
    stray.setAttribute('contenteditable', 'true')
    document.body.appendChild(stray)

    await expect(
      drive(
        driver.typeText({ target: stray, text: 'x', readArmText: () => arm.armText(), ...TYPING }),
        raf,
      ),
    ).rejects.toThrow(/typeText:targetOwnership/)
    expect(ledger.failures()).toHaveLength(1)
  })

  it('aborts below the latency sample floor rather than reporting percentiles over a handful', async () => {
    const { arm, driver, raf, ledger } = rig()
    await expect(
      drive(
        driver.typeText({
          target: arm.editor,
          text: 'ab',
          readArmText: () => arm.armText(),
          minLatencySamples: 200,
          ...TYPING,
        }),
        raf,
      ),
    ).rejects.toThrow(/typeText:sampleFloor/)
    expect(ledger.seal(3).map((p) => p.gesture)).toEqual([
      'typeText',
      'typeText:inputDelivery',
      'typeText:sampleFloor',
    ])
  })

  it('records the Event Timing count as corroboration, and zero entries is not a failure', async () => {
    const { arm, driver, raf } = rig()
    const result = await drive(
      driver.typeText({
        target: arm.editor,
        text: 'ab',
        readArmText: () => arm.armText(),
        minLatencySamples: 2,
        eventTimingEntryCount: () => 0, // what synthetic dispatch actually produces
        ...TYPING,
      }),
      raf,
    )

    expect(result.eventTimingEntriesObserved).toBe(0)
    expect(result.proofs.every((proof) => proof.stateMatched)).toBe(true)
  })

  it('throws for a target with nowhere to put text, rather than reporting a false pass', async () => {
    const { arm, driver, raf } = rig()
    const plain = document.createElement('div') // inside the arm, but not editable
    arm.root.appendChild(plain)
    await expect(
      drive(
        driver.typeText({ target: plain, text: 'x', readArmText: () => arm.armText(), ...TYPING }),
        raf,
      ),
    ).rejects.toThrow(/not an input, textarea or contenteditable/)
  })
})

// ---- the proof chain -----------------------------------------------------------------

describe('the ledger a driver is constructed with', () => {
  it('accumulates every gesture\'s proofs, so a run cannot be assembled without them', async () => {
    const { arm, driver, raf, ledger } = rig({ elements: elements() })
    await drive(driver.pan({ dx: 100, dy: 0, ...SHORT }), raf)
    await drive(driver.dragElement({ id: 'n1', dx: 60, dy: 0, ...SHORT }), raf)

    expect(ledger.size).toBe(4)
    expect(ledger.seal(4)).toHaveLength(4)
    expect(ledger.failures().map((p) => `${p.gesture}: ${p.actual}`)).toEqual([])
    expect(arm.getViewport().x).toBeLessThan(0)
  })

  it('keeps the evidence recorded by a gesture that aborted', async () => {
    const { driver, raf, ledger } = rig({ wireListeners: false })
    await expect(drive(driver.pan({ dx: 100, dy: 0, ...SHORT }), raf)).rejects.toThrow()
    expect(ledger.size).toBe(1)
    expect(ledger.failures()[0].gesture).toBe('pan:pressPoint')
  })
})
