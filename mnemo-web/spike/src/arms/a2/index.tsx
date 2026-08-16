import { createRoot, type Root } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '../shared/arm.css'
import './arm.css'

import type {
  ArmHandle,
  ArmModule,
  ArmMountArgs,
  MoveOpLike,
  OnScreenCounts,
  Point,
  Viewport,
} from '../../harness/contract'
import type { MindmapElement, MindmapFixture } from '../../fixture/model'
import { MAX_SCALE, MIN_SCALE } from '../../fixture/model'
import { createCuller, type Culler } from './culler'
import { createLodController, readMarkerRung, type LodController } from '../shared/lod'
import { countOnScreen } from '../shared/on-screen'
import { parseCommittedTransform } from '../shared/transform'
import { svgCameraTransform, worldTransform } from './camera'
import { createEdgeCanvasRenderer, type EdgeCanvasRenderer } from './edge-canvas'
import {
  createEdgeStrategySelector,
  type EdgeStrategy,
  type EdgeStrategySelector,
} from './edge-strategy'
import type { EdgeMode } from './edge-style'
import { createFrameProbe } from './frame-probe'
import { installGestures } from './gestures'
import { Scene, type EdgeLayerRefs, type MountedScene } from './scene'
import {
  createSceneIndex,
  edgeCullKey,
  nodeCullKey,
  type SceneIndex,
} from './scene-index'

/**
 * A2: a hand-rolled DOM renderer.
 *
 * Built because A1's numbers located React Flow's cost in per-frame JavaScript proportional to
 * the node count: a pan ran at 20fps with one element on screen, culling 99% of the DOM bought
 * only 2x, and culling made the all-visible case worse. Everything in this arm follows from
 * that one finding.
 *
 * React renders the scene ONCE and is then out of the loop entirely. A pan writes one transform
 * string to one element. A drag writes a transform per moved element and repaints only the
 * edges that touch them. Nothing walks the document on a frame. That is the hypothesis, stated
 * as an architecture so the measurement can falsify it.
 *
 * Keeping React for the initial render is not a hedge. It keeps native text, focus, IME and
 * accessibility, which is the whole reason to try DOM before canvas, and it lets the StrictMode
 * probe sit inside the tree that is actually under measurement.
 */

function clampViewport(viewport: Viewport): Viewport {
  return { ...viewport, zoom: Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.zoom)) }
}

/** Content kinds that render a `.spike-label`, which is what an inline edit types into. */
function hasEditableLabel(element: MindmapElement): boolean {
  const kind = element.content.kind
  return kind === 'text' || kind === 'freeText'
}

interface Editor {
  readonly host: HTMLElement
  readonly onBeforeInput: (event: Event) => void
  text: string
}

/**
 * Named rather than positional, because the handle now needs three DOM references, two edge
 * substrates and four collaborators, and a ten-argument constructor of mostly interchangeable
 * element types is a bug waiting for someone to reorder it.
 */
interface A2Deps {
  readonly root: Root
  readonly container: HTMLElement
  readonly mounted: MountedScene
  /** The canvas edge renderer, present only in canvas mode. */
  readonly edgeCanvas: EdgeCanvasRenderer | null
  readonly fixture: MindmapFixture
  readonly scene: SceneIndex
  readonly lod: LodController
  readonly culler: Culler
  readonly initialViewport: Viewport
  /** Whether to verify that the canvas actually painted. Perturbs the measurement; see below. */
  readonly paintCheck: boolean
  readonly edgeStrategy: EdgeStrategySelector
  /** Needed to rebuild the culler after a swap with the same setting it was created with. */
  readonly cullEnabled: boolean
}

class A2Handle implements ArmHandle {
  readonly id = 'a2-dom' as const

  private readonly root: Root
  private readonly container: HTMLElement
  private readonly pane: HTMLElement
  private readonly world: HTMLElement
  /** Null unless edges are drawn as SVG. Reassigned when a hybrid run swaps substrates. */
  private edgeCamera: SVGGElement | null
  /** Null unless edges are drawn on a canvas. Reassigned on a substrate swap. */
  private edgeCanvas: EdgeCanvasRenderer | null
  private readonly fixture: MindmapFixture
  private readonly scene: SceneIndex
  private readonly lod: LodController
  /** Rebuilt on a substrate swap: its targets hold the outgoing layer's path elements. */
  private culler: Culler
  private readonly frameMembers: ReadonlyMap<string, readonly string[]>
  /** The canvas element itself, kept so the one-time paint check can read pixels back. */
  private edgeCanvasElement: HTMLCanvasElement | null
  private readonly edgeStrategy: EdgeStrategySelector
  private readonly setSubstrate: (substrate: EdgeMode) => void
  private readonly cullEnabled: boolean
  /** Counts crossings, so a run can prove the switch fired and did not flap. */
  private substrateSwaps = 0
  private readonly frameProbe = createFrameProbe()
  private lastCommitAt = performance.now()

  private canvasPaintChecked = false
  private readonly paintCheckEnabled: boolean

  private viewport: Viewport
  private selection = new Set<string>()
  private pendingOps: MoveOpLike[] = []
  private uninstallGestures: () => void = () => {}
  private editor: Editor | null = null

  constructor(deps: A2Deps) {
    const { root, container, mounted, fixture, scene, lod, culler } = deps
    this.root = root
    this.container = container
    this.pane = mounted.pane
    this.world = mounted.world
    this.edgeCamera = mounted.edgeCamera
    this.edgeCanvas = deps.edgeCanvas
    this.edgeCanvasElement = mounted.edgeCanvas
    this.paintCheckEnabled = deps.paintCheck
    this.edgeStrategy = deps.edgeStrategy
    this.setSubstrate = mounted.setSubstrate
    this.cullEnabled = deps.cullEnabled
    this.fixture = fixture
    this.scene = scene
    this.lod = lod
    this.culler = culler
    this.viewport = clampViewport(deps.initialViewport)

    const members = new Map<string, readonly string[]>()
    for (const element of fixture.elements) {
      if (element.content.kind === 'frame') members.set(element.id, element.content.childIds)
    }
    this.frameMembers = members

    this.commitViewport()
    this.uninstallGestures = installGestures({
      pane: this.pane,
      scene,
      getViewport: () => this.viewport,
      setViewport: (v) => {
        this.viewport = v
        this.commitViewport()
      },
      membersOf: (id) => this.frameMembers.get(id),
      getSelection: () => this.selection,
      setSelection: (ids) => this.setSelection(ids),
      // The moving elements AND their edges: an edge whose endpoint is being dragged is
      // repainted every frame, and repainting a hidden path would be work with nothing to show
      // for it while the edge visibly detached from the node it belongs to.
      pin: (ids) =>
        this.culler.pin([
          ...ids.map(nodeCullKey),
          ...this.scene.incidentEdges(ids).map(edgeCullKey),
        ]),
      unpinAll: () => this.culler.unpinAll(),
      repaintEdges: (ids) => this.repaintEdges(ids),
      commitOps: (ops) => {
        this.pendingOps = [...this.pendingOps, ...ops]
      },
    })
  }

  /**
   * The only place the camera reaches the DOM. One style write and, on a band change, one
   * attribute write; never a walk over the elements.
   *
   * The canvas edge mode is the exception, and deliberately so: a canvas holds no retained
   * per-edge state, so a camera change is a full redraw of what is in view. That is the trade
   * the mode is here to price, against an SVG layer whose cost per gesture is fixed no matter
   * how few edges are visible.
   */
  private commitViewport(): void {
    // Writes first, then the clientWidth read. Reading the box up front would look tidier but it
    // would land the forced layout before the transform and data-lod writes instead of after
    // them, which quietly changes what every arm measures.
    this.world.style.transform = worldTransform(this.viewport)
    this.edgeCamera?.setAttribute('transform', svgCameraTransform(this.viewport))
    this.lod.update(this.viewport.zoom)
    // Asked before the culler updates, so a swap's rebuild lands on this camera rather than
    // leaving one frame indexed against the previous one.
    const nextSubstrate = this.edgeStrategy.update(this.viewport.zoom)
    if (nextSubstrate !== null) this.setSubstrate(nextSubstrate)
    // `clientWidth` forces a style and layout flush here, one frame after the culler wrote
    // `display` on whatever entered or left the view. That looked like the zoom sweep's remaining
    // hitch and it is not: reading the box once per run instead of once per commit left the hitch
    // in place (max 150-183ms against a 133ms baseline), so the flush is not what pays for the
    // visibility writes. Left as a per-frame read, which is what every other arm's numbers were
    // taken against.
    this.culler.update(this.viewport, this.container.clientWidth, this.container.clientHeight)

    // After the culler, before the canvas draw: this is the point where the frame's culling work
    // is known and nothing else has run yet. Reading the clock and eight numbers allocates nothing.
    const cull = this.culler.lastStats()
    const now = performance.now()
    this.frameProbe.record({
      gapMs: now - this.lastCommitAt,
      zoom: this.viewport.zoom,
      cullerMs: cull.durationMs,
      cullerDid: cull.did,
      scanned: cull.scanned,
      shown: cull.shown,
      hidden: cull.hidden,
      rendered: this.culler.renderedCount(),
    })
    this.lastCommitAt = now

    if (this.edgeCanvas) {
      this.edgeCanvas.resize(
        this.container.clientWidth,
        this.container.clientHeight,
        window.devicePixelRatio || 1,
      )
      this.drawEdgeCanvas()
    }
  }

  /**
   * Repaints the DOM an edge owns, and redraws the canvas when that is where the strokes live.
   *
   * A canvas cannot rewrite one edge in place: clearing the pixels under a curve means clearing
   * everything that shares them. So a moved endpoint costs a redraw of the visible set rather
   * than of the named edges, which is still bounded by what is on screen and never by the
   * document.
   */
  private repaintEdges(edgeIds: readonly string[]): void {
    this.scene.repaintEdges(edgeIds)
    if (this.edgeCanvas) {
      // Only these edges moved, so only these lose their cached geometry. Everything else keeps
      // it, which is what makes a drag cost the moved edges rather than the visible ones.
      this.edgeCanvas.invalidate(edgeIds)
      this.drawEdgeCanvas()
    }
  }

  /**
   * Adopts the edge layer React just swapped in, and drops everything that belonged to the old one.
   *
   * Called from the scene's own effect after the swap has committed to the DOM, never from the
   * frame that requested it: the incoming layer does not exist until React has rendered it, so
   * re-reading the DOM any earlier would bind to the layer on its way out.
   */
  adoptEdgeLayer(refs: EdgeLayerRefs): void {
    this.substrateSwaps += 1

    this.edgeCanvas?.dispose()
    this.edgeCamera = refs.edgeCamera
    this.edgeCanvasElement = refs.edgeCanvas
    this.edgeCanvas = createEdgeCanvas(refs.edgeCanvas, this.fixture, this.scene)
    // A fresh canvas has never been painted, so the one-time proof has to run again rather than
    // report the outgoing layer's result.
    this.canvasPaintChecked = false

    // The index still points at the outgoing layer's paths, and the culler's targets hold those
    // same dead elements, so both have to be re-read before anything asks what is visible.
    this.scene.rebindEdgeDom(refs.substrate)
    this.culler = createCuller(this.scene.cullTargets(), this.cullEnabled)

    this.commitViewport()
  }

  private drawEdgeCanvas(): void {
    const renderer = this.edgeCanvas
    if (!renderer) return
    // The culler maintains the visible edge set as it retains and releases, so this is a live
    // read rather than a per-frame derivation. Walking every rendered key and slicing an id out
    // of each would cost the visible NODE count too and allocate a string per edge per frame,
    // which is work the SVG mode never does and would show up as canvas being slower than it is.
    // Pinned edges are rendered by definition, which is what keeps an edge attached to a node
    // dragged past the edge of the view.
    const drawn = renderer.draw(this.viewport, this.culler.renderedEdgeIds())
    this.assertCanvasPainted(drawn)
  }

  /**
   * Proves, once, that the canvas mode is actually putting pixels on the screen.
   *
   * This is the same class of check as the driver's proof-of-execution assertions, and it exists
   * for the same reason they do. A canvas that draws nothing, or draws off-screen because the
   * camera matrix is wrong, would post the best frame times in the entire spike and clear every
   * gate. There is no scenario proof that asserts edge geometry, so without this the most
   * flattering possible failure is also the most silent one.
   *
   * OFF unless asked for, because the check itself perturbs what it is checking. `getImageData`
   * forces a readback off the GPU, and Chromium responds by dropping the canvas to CPU-backed
   * rendering for the rest of its life, after which every frame re-uploads the whole surface.
   * That showed up as a canvas mode whose CLOCK CALIBRATION, a trivial always-dirty animation
   * with no drawing in it at all, read 83ms per frame at rest in exactly the scenarios where
   * enough edges were visible for the check to fire. Verification is therefore its own run, and
   * the measured runs are left alone.
   */
  private assertCanvasPainted(drawnEdges: number): void {
    if (!this.paintCheckEnabled || this.canvasPaintChecked || drawnEdges === 0) return
    this.canvasPaintChecked = true

    const canvas = this.edgeCanvasElement
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    // Alpha only, every fourth byte. Any non-zero alpha anywhere means something was rasterised
    // inside the viewport, which is precisely the claim being made.
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) return
    }
    throw new Error(
      `the edge canvas is blank after drawing ${drawnEdges} edge(s): the strokes are not reaching ` +
        'the viewport, so every frame time this mode reports would be the cost of drawing nothing',
    )
  }

  getViewport(): Viewport {
    return this.viewport
  }

  setViewport(viewport: Viewport): void {
    this.viewport = clampViewport(viewport)
    this.commitViewport()
  }

  getElementPosition(id: string): Point | undefined {
    return this.scene.positionOf(id)
  }

  getTransformTarget(): HTMLElement | null {
    return this.world
  }

  readCommittedViewport(): Viewport | null {
    return parseCommittedTransform(this.world)
  }

  getGestureTarget(): HTMLElement {
    return this.pane
  }

  getElementNode(id: string): HTMLElement | null {
    return this.scene.hostFor(id)
  }

  setLodEnabled(enabled: boolean): void {
    this.lod.setEnabled(enabled)
    this.lod.update(this.viewport.zoom)
  }

  isLodEnabled(): boolean {
    return this.lod.isEnabled()
  }

  getOnScreenCounts(): OnScreenCounts {
    return countOnScreen(this.fixture, this.viewport, this.container)
  }

  setSelection(ids: readonly string[]): void {
    this.selection = new Set(ids)
    this.scene.setSelected(ids)
  }

  applyRelayout(positions: ReadonlyMap<string, Point>): Promise<void> {
    const ids = [...positions.keys()]
    this.scene.writePositions(ids, (id) => positions.get(id))
    // Every edge rather than the incident set: a relayout moves most of the document, so
    // resolving which edges are affected costs about what repainting them all does, and gets
    // the answer wrong if it misses one. In canvas mode this walk only moves labels; the
    // strokes are redrawn once below, after the culler knows where everything went.
    this.scene.repaintEdges(this.scene.allEdgeIds())
    // Every element is somewhere new, so the culler's grid is wholesale invalid. Re-indexing is
    // proportional to the document, which is right for an operation that moved all of it, and
    // it lands inside the time-to-painted number rather than after it.
    this.culler.rebuild()
    // `clientWidth` forces a style and layout flush here, one frame after the culler wrote
    // `display` on whatever entered or left the view. That looked like the zoom sweep's remaining
    // hitch and it is not: reading the box once per run instead of once per commit left the hitch
    // in place (max 150-183ms against a 133ms baseline), so the flush is not what pays for the
    // visibility writes. Left as a per-frame read, which is what every other arm's numbers were
    // taken against.
    this.culler.update(this.viewport, this.container.clientWidth, this.container.clientHeight)
    // Every cached curve is stale for the same reason the grid is: both endpoints of every edge
    // are somewhere new.
    this.edgeCanvas?.invalidateAll()
    this.drawEdgeCanvas()
    return new Promise<void>((resolve) => {
      // Two frames: the first commits the writes, the second is the one that can actually have
      // painted them. Resolving earlier would report a number that excludes the paint the
      // scenario exists to measure.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  }

  drainPendingOps(): readonly MoveOpLike[] {
    const ops = this.pendingOps
    this.pendingOps = []
    return ops
  }

  /**
   * The swap count separates the three outcomes a frame histogram cannot tell apart: the hybrid
   * strategy never fired, fired at the crossings it should have, or flapped across the boundary.
   */
  /**
   * Opens the probe's window, discarding the setup and calibration pauses recorded before it.
   * Those are idle time, not dropped frames, and they are three thousand milliseconds wide.
   */
  beginMeasurementWindow(): void {
    this.frameProbe.beginWindow()
    this.lastCommitAt = performance.now()
  }

  getDiagnostics(): Readonly<Record<string, number>> {
    return {
      substrateSwaps: this.substrateSwaps,
      edgeSubstrateIsCanvas: this.edgeCanvas ? 1 : 0,
      domRenderedNodes: this.countDomRenderedNodes(),
      ...this.frameProbe.summary(),
    }
  }

  /**
   * Elements the ENGINE would actually render, read back off computed style.
   *
   * Every other count in this arm is bookkeeping or geometry, and neither notices a page that
   * renders nothing: on-screen counts come from element bounds, which a hidden element still has,
   * and the culler's own tally is whatever the culler believes. A change that left every element
   * hidden therefore measured a flawless sixty frames a second across the entire scenario matrix
   * before anything caught it. This is the check that would have caught it, so it runs on every
   * result rather than living in a probe someone has to remember to use.
   *
   * Cost is one computed-style read per element, once, after the measured window has closed.
   */
  private countDomRenderedNodes(): number {
    let rendered = 0
    for (const host of this.pane.querySelectorAll<HTMLElement>('.a2-node')) {
      const style = getComputedStyle(host)
      if (style.display !== 'none' && style.visibility !== 'hidden') rendered += 1
    }
    return rendered
  }

  // ---- inline editing, for the typing scenario --------------------------------------------

  /**
   * The element a real inline edit would type into: the nearest labelled element to the middle
   * of the current view, made editable in place. Chosen from what is on screen rather than
   * fixed, because a latency measured against an off-screen node would not include the paint.
   *
   * The arm owns the text. `beforeinput` is prevented and the model is updated here, so
   * `readEditorText` reports the arm's own state rather than characters the driver inserted
   * itself, which is what stops a dead page from passing the typing proof.
   */
  getEditorTarget(): HTMLElement {
    if (this.editor) return this.editor.host

    const centre = {
      x: this.viewport.x + this.container.clientWidth / (2 * this.viewport.zoom),
      y: this.viewport.y + this.container.clientHeight / (2 * this.viewport.zoom),
    }
    let best: { element: MindmapElement; distance: number } | null = null
    for (const element of this.fixture.elements) {
      if (!hasEditableLabel(element)) continue
      const distance = Math.hypot(
        element.x + element.width / 2 - centre.x,
        element.y + element.height / 2 - centre.y,
      )
      if (!best || distance < best.distance) best = { element, distance }
    }
    if (!best) throw new Error('the fixture contains no labelled element to edit')

    const host = this.scene.labelFor(best.element.id)
    if (!host) throw new Error(`element "${best.element.id}" rendered no label to edit`)

    const editor: Editor = {
      host,
      text: host.textContent ?? '',
      onBeforeInput: (event: Event): void => {
        if (!(event instanceof InputEvent)) return
        if (event.inputType !== 'insertText' || event.data === null) return
        event.preventDefault()
        editor.text += event.data
        host.textContent = editor.text
      },
    }

    host.setAttribute('contenteditable', 'true')
    host.addEventListener('beforeinput', editor.onBeforeInput)
    this.editor = editor
    return host
  }

  readEditorText(): string {
    return this.editor?.text ?? ''
  }

  dispose(): void {
    this.uninstallGestures()
    this.edgeCanvas?.dispose()
    if (this.editor) {
      this.editor.host.removeEventListener('beforeinput', this.editor.onBeforeInput)
      this.editor = null
    }
    this.root.unmount()
  }
}

export const a2Module: ArmModule = {
  id: 'a2-dom',

  mount(args: ArmMountArgs): Promise<ArmHandle> {
    return mountA2(args, null)
  },

  mountWithProbe(args: ArmMountArgs, probe: React.ReactNode): Promise<ArmHandle> {
    return mountA2(args, probe)
  },
}

/**
 * Whether the world gets its own composited layer. Read from the URL rather than threaded
 * through `ArmMountArgs` for the same reason a1 reads its culling flag that way: it is an
 * arm-specific knob being priced, not a property of the scenario, and every other arm would
 * have to carry a field that means nothing to it. Defaults on, and `?layer=0` turns it off.
 */
export const A2_LAYER_QUERY_FLAG = 'layer'

/**
 * The composited-layer default is OFF, which is the opposite of where this arm started.
 *
 * Promoting the world looked obviously right: a pan becomes a transform on an existing layer.
 * Measured, it is a bad trade. Culling already makes a pan cheap without it, and the layer's
 * paint bounds on the forest fixture are roughly 2,900 by 127,000 canvas pixels, which at the
 * 0.1 zoom the scenarios drive did not merely slow the renderer down but stopped animation
 * frames arriving at all. `?layer=1` turns it back on, and that is the run that prices it.
 */
const LAYER_DEFAULT = false

/**
 * Which substrate draws the edges.
 *
 * `?edges=off` drops them entirely, which is diagnostic only and never gating. That diagnostic
 * is what turned this from a boolean into three modes: with edges off, three scenarios moved
 * from 30fps to a clean 60, and the cost turned out to be a fixed frame per gesture rather than
 * anything proportional to how many paths were on screen. `?edges=canvas` prices the alternative
 * that has no retained children for the engine to invalidate.
 */
export const A2_EDGES_QUERY_FLAG = 'edges'

/**
 * `?edges=hybrid` uses each substrate only where it measured well: canvas at readable zoom, SVG
 * at overview. See `edge-strategy.ts` for the numbers that produced that split.
 */
function readEdgeStrategy(params: URLSearchParams): EdgeStrategy {
  const value = params.get(A2_EDGES_QUERY_FLAG)
  if (value === 'off') return 'off'
  if (value === 'canvas') return 'canvas'
  if (value === 'hybrid') return 'hybrid'
  return 'svg'
}

/**
 * `?nodecull=0` keeps every element rendered. Defaults on, unlike a1's culling flag, because
 * for this arm culling is the design rather than a mitigation: without it the engine's own
 * paint walk is proportional to the document and a pan showing one element costs fifty
 * milliseconds. Off is the diagnostic arm that prices exactly that.
 */
export const A2_NODE_CULL_QUERY_FLAG = 'nodecull'

/**
 * `?paintcheck=1` verifies that the canvas mode is genuinely rasterising strokes.
 *
 * Off by default because the check perturbs what it measures: the pixel readback drops the canvas
 * to CPU-backed rendering for good. Run it once to confirm the mode draws, then measure without it.
 */
export const A2_PAINT_CHECK_QUERY_FLAG = 'paintcheck'

async function mountA2(args: ArmMountArgs, probe: React.ReactNode): Promise<ArmHandle> {
  const { container, fixture, initialViewport, lodEnabled } = args
  const params = new URLSearchParams(window.location.search)
  const lod = createLodController(container, lodEnabled, readMarkerRung(params))
  const layerParam = params.get(A2_LAYER_QUERY_FLAG)
  const promoteLayer = layerParam === null ? LAYER_DEFAULT : layerParam === '1'
  const strategy = readEdgeStrategy(params)
  const cullNodes = params.get(A2_NODE_CULL_QUERY_FLAG) !== '0'
  const paintCheck = params.get(A2_PAINT_CHECK_QUERY_FLAG) === '1'

  const edgeStrategy = createEdgeStrategySelector(strategy, initialViewport.zoom)
  const edgeMode = edgeStrategy.current()
  const maySwapSubstrate = strategy === 'hybrid'

  // Assigned before the first render can call it, because React runs the swap effect
  // synchronously after a commit and the handle does not exist until the mount promise resolves.
  let onEdgeLayerChanged: (refs: EdgeLayerRefs) => void = () => {}

  const root = createRoot(container)
  const mounted = await new Promise<MountedScene>((resolve) => {
    root.render(
      <>
        {probe}
        <Scene
          fixture={fixture}
          promoteLayer={promoteLayer}
          edgeMode={edgeMode}
          maySwapSubstrate={maySwapSubstrate}
          onMounted={resolve}
          onEdgeLayerChanged={(refs) => onEdgeLayerChanged(refs)}
        />
      </>,
    )
  })

  // Indexed after the render rather than through five thousand ref callbacks: one pass over the
  // finished subtree is cheaper, and it keeps the components free of anything but presentation.
  const scene = createSceneIndex(fixture, mounted.pane, edgeMode)
  const culler = createCuller(scene.cullTargets(), cullNodes)

  const handle = new A2Handle({
    root,
    container,
    mounted,
    edgeCanvas: createEdgeCanvas(mounted.edgeCanvas, fixture, scene),
    fixture,
    scene,
    lod,
    culler,
    initialViewport,
    paintCheck,
    edgeStrategy,
    cullEnabled: cullNodes,
  })
  onEdgeLayerChanged = (refs) => handle.adoptEdgeLayer(refs)
  return handle
}

function createEdgeCanvas(
  canvas: HTMLCanvasElement | null,
  fixture: MindmapFixture,
  scene: SceneIndex,
): EdgeCanvasRenderer | null {
  if (!canvas) return null
  const context = canvas.getContext('2d')
  // Loudly rather than silently: a canvas run that quietly drew nothing would report the best
  // frame times in the spike and mean nothing at all.
  if (!context) throw new Error('the canvas edge mode needs a 2D context and none was available')
  return createEdgeCanvasRenderer({
    canvas,
    context,
    edges: fixture.edges,
    boxOf: (id) => scene.boxOf(id),
  })
}
