import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeChange,
  type Viewport as RfViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import 'katex/dist/katex.min.css'
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
import { nodeTypes } from './nodes'
import { edgeTypes, toRfEdges } from './edges'
import { createFrameInterceptor } from './frames'
import { createLodController, type LodController } from './lod'
import { imageUrlFor } from './assets'

// The tree is mounted without StrictMode on purpose: its double invocation would double
// the work being measured. The harness asserts its absence before recording anything, so
// this is enforced rather than merely intended.
const NODE_TYPE_BY_CONTENT: Record<string, string> = {
  text: 'mm-text',
  task: 'mm-task',
  code: 'mm-code',
  math: 'mm-math',
  link: 'mm-link',
  note: 'mm-ref',
  flashcard: 'mm-ref',
  shape: 'mm-shape',
  freeText: 'mm-freetext',
  image: 'mm-image',
  frame: 'mm-frame',
}

function toRfNode(element: MindmapElement): Node {
  const type = NODE_TYPE_BY_CONTENT[element.content.kind] ?? 'mm-text'
  return {
    id: element.id,
    type,
    position: { x: element.x, y: element.y },
    // Supplied up front so React Flow does not have to measure 5,000 nodes before it can
    // lay anything out, and so a node's own content can never change its box.
    width: element.width,
    height: element.height,
    data:
      element.content.kind === 'image'
        ? { content: element.content, src: imageUrlFor(element.content.assetId) }
        : element.content.kind === 'math'
          ? { content: element.content, width: element.width, height: element.height, id: element.id }
          : { content: element.content },
    draggable: true,
    selectable: true,
  }
}

/**
 * Parses `matrix(a, b, c, d, e, f)` off the committed viewport transform and converts it into
 * the same camera-position units `getViewport` reports, so comparing the two is comparing a
 * state to what actually painted rather than to a different coordinate system.
 */
function parseTransform(el: HTMLElement | null): Viewport | null {
  if (!el) return null
  const value = getComputedStyle(el).transform
  if (!value || value === 'none') return null
  const match = /matrix\(([^)]+)\)/.exec(value)
  if (!match?.[1]) return null
  const parts = match[1].split(',').map((p) => Number.parseFloat(p.trim()))
  if (parts.length < 6 || parts.some(Number.isNaN)) return null
  const zoom = parts[0] as number
  const translateX = parts[4] as number
  const translateY = parts[5] as number
  if (zoom === 0) return null
  return { x: -translateX / zoom, y: -translateY / zoom, zoom }
}

/**
 * Subscribes to zoom on its own so the component owning the node array never re-renders
 * during a pan or zoom. Rendering nothing is the point.
 */
function LodWatcher({
  controller,
  onCrossing,
}: {
  controller: LodController
  onCrossing: (zoom: number) => void
}): null {
  const zoom = useStore((s) => s.transform[2])
  useEffect(() => {
    if (controller.update(zoom)) onCrossing(zoom)
  }, [zoom, controller, onCrossing])
  return null
}

/**
 * React Flow keeps every node mounted by default, so a pan re-composites the whole document
 * whether or not any of it is on screen. `onlyRenderVisibleElements` culls to the viewport,
 * which is the obvious mitigation and the one the spike has to price rather than assume: it
 * cannot help at all in the scenario that matters most, where the whole map is inside the
 * viewport and there is nothing to cull.
 */
export const A1_CULL_QUERY_FLAG = 'cull'

interface BridgeProps {
  readonly fixture: MindmapFixture
  readonly initialViewport: Viewport
  readonly lod: LodController
  readonly cull: boolean
  readonly onReady: (api: InternalApi) => void
}

interface InternalApi {
  getViewport(): Viewport
  setViewport(v: Viewport): void
  getElementPosition(id: string): Point | undefined
  setSelection(ids: readonly string[]): void
  applyRelayout(positions: ReadonlyMap<string, Point>): Promise<void>
  drainOps(): readonly MoveOpLike[]
  lastCrossingZoom(): number | null
}

function Bridge({ fixture, initialViewport, lod, cull, onReady }: BridgeProps): React.ReactElement {
  const rf = useReactFlow()
  const [nodes, setNodes] = useState<Node[]>(() => fixture.elements.map(toRfNode))
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const edges = useMemo<Edge[]>(() => toRfEdges(fixture.edges), [fixture])

  const frameMembers = useMemo(() => {
    const map = new Map<string, readonly string[]>()
    for (const element of fixture.elements) {
      if (element.content.kind === 'frame') map.set(element.id, element.content.childIds)
    }
    return map
  }, [fixture])

  const interceptor = useMemo(
    () =>
      createFrameInterceptor({
        membersOf: (id) => frameMembers.get(id),
        isFrame: (id) => frameMembers.has(id),
        snapshotPositions: (ids) => {
          const wanted = new Set(ids)
          const found = new Map<string, Point>()
          for (const node of nodesRef.current) {
            if (wanted.has(node.id)) found.set(node.id, node.position)
          }
          return found
        },
      }),
    [frameMembers],
  )

  // Operations the arm would send at pointer-up. Built here, from the final change list, so
  // there is exactly one producer: the frame interceptor has already appended its member moves
  // by this point, which means frames and ordinary nodes emit through the same path and no id
  // can be written twice by two producers that each thought they owned it.
  const pendingOpsRef = useRef<MoveOpLike[]>([])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const withFrames = interceptor.apply(changes)

      const settled = new Map<string, MoveOpLike>()
      for (const change of withFrames) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          settled.set(change.id, { id: change.id, x: change.position.x, y: change.position.y })
        }
      }
      if (settled.size > 0) {
        pendingOpsRef.current = [...pendingOpsRef.current, ...settled.values()]
      }

      setNodes((current) => applyNodeChanges(withFrames, current))
    },
    [interceptor],
  )

  const crossingRef = useRef<number | null>(null)
  const onCrossing = useCallback((zoom: number) => {
    crossingRef.current = zoom
  }, [])

  useEffect(() => {
    onReady({
      // React Flow reports its viewport as a screen-space TRANSLATION, where panning right
      // increases x. The harness contract is a camera position: the canvas coordinate sitting
      // at the viewport's top-left, which panning right DECREASES, matching the desktop's
      // convention. Converting here rather than teaching the driver about React Flow keeps
      // every arm answering the same question in the same units.
      getViewport: () => {
        const v = rf.getViewport()
        return { x: -v.x / v.zoom, y: -v.y / v.zoom, zoom: v.zoom }
      },
      setViewport: (v) => {
        rf.setViewport(
          { x: -v.x * v.zoom, y: -v.y * v.zoom, zoom: v.zoom } satisfies RfViewport,
          { duration: 0 },
        )
      },
      getElementPosition: (id) => nodesRef.current.find((n) => n.id === id)?.position,
      setSelection: (ids) => {
        const wanted = new Set(ids)
        setNodes((current) =>
          current.map((n) =>
            n.selected === wanted.has(n.id) ? n : { ...n, selected: wanted.has(n.id) },
          ),
        )
      },
      applyRelayout: (positions) =>
        new Promise<void>((resolve) => {
          setNodes((current) =>
            current.map((n) => {
              const next = positions.get(n.id)
              return next ? { ...n, position: next } : n
            }),
          )
          // Two frames: the first commits React's update, the second is the one that can
          // actually have painted it. Resolving earlier would report a number that
          // excludes the paint the scenario exists to measure.
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
      drainOps: () => {
        const ops = pendingOpsRef.current
        pendingOpsRef.current = []
        // The interceptor keeps its own ledger for its unit tests; draining it here as well
        // keeps a frame drag from leaving a stale entry behind for the next gesture to find.
        interceptor.drainOps()
        return ops
      },
      lastCrossingZoom: () => crossingRef.current,
    })
  }, [rf, onReady, interceptor])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultViewport={{ x: initialViewport.x, y: initialViewport.y, zoom: initialViewport.zoom }}
      minZoom={0.1}
      maxZoom={5}
      onlyRenderVisibleElements={cull}
      // Mnemo computes layout server-side and never lets React Flow attach edges, so the
      // interaction surface is trimmed to what the product actually offers.
      nodesConnectable={false}
      elementsSelectable
      panOnDrag
      zoomOnScroll
      proOptions={{ hideAttribution: true }}
    >
      <LodWatcher controller={lod} onCrossing={onCrossing} />
    </ReactFlow>
  )
}

class A1Handle implements ArmHandle {
  readonly id = 'a1-reactflow' as const

  private readonly root: Root
  private readonly container: HTMLElement
  private readonly fixture: MindmapFixture
  private readonly lod: LodController
  private readonly api: InternalApi

  constructor(
    root: Root,
    container: HTMLElement,
    fixture: MindmapFixture,
    lod: LodController,
    api: InternalApi,
  ) {
    this.root = root
    this.container = container
    this.fixture = fixture
    this.lod = lod
    this.api = api
  }

  getViewport(): Viewport {
    return this.api.getViewport()
  }

  setViewport(viewport: Viewport): void {
    this.api.setViewport(viewport)
  }

  getElementPosition(id: string): Point | undefined {
    return this.api.getElementPosition(id)
  }

  getTransformTarget(): HTMLElement | null {
    return this.container.querySelector<HTMLElement>('.react-flow__viewport')
  }

  readCommittedViewport(): Viewport | null {
    return parseTransform(this.getTransformTarget())
  }

  getGestureTarget(): HTMLElement {
    const pane = this.container.querySelector<HTMLElement>('.react-flow__pane')
    if (!pane) throw new Error('React Flow pane is not mounted, so no gesture can be dispatched')
    return pane
  }

  getElementNode(id: string): HTMLElement | null {
    // React Flow stamps the node id onto its own wrapper, which is also the element d3-drag is
    // bound to, so this is the node a real press on that element would be handled by.
    return this.container.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${CSS.escape(id)}"]`,
    )
  }

  setLodEnabled(enabled: boolean): void {
    this.lod.setEnabled(enabled)
    this.lod.update(this.getViewport().zoom)
  }

  isLodEnabled(): boolean {
    return this.lod.isEnabled()
  }

  getOnScreenCounts(): OnScreenCounts {
    // getViewport already reports the camera position in canvas units, so the visible rect is
    // just that corner plus the viewport size scaled down by the zoom.
    const { x: left, y: top, zoom } = this.getViewport()
    const w = this.container.clientWidth / zoom
    const h = this.container.clientHeight / zoom

    let elements = 0
    const visibleIds = new Set<string>()
    for (const e of this.fixture.elements) {
      if (e.x < left + w && e.x + e.width > left && e.y < top + h && e.y + e.height > top) {
        elements++
        visibleIds.add(e.id)
      }
    }

    let edges = 0
    for (const edge of this.fixture.edges) {
      if (visibleIds.has(edge.fromId) || visibleIds.has(edge.toId)) edges++
    }

    return { elements, edges, domNodes: this.container.querySelectorAll('*').length }
  }

  setSelection(ids: readonly string[]): void {
    this.api.setSelection(ids)
  }

  applyRelayout(positions: ReadonlyMap<string, Point>): Promise<void> {
    return this.api.applyRelayout(positions)
  }

  drainPendingOps(): readonly MoveOpLike[] {
    return this.api.drainOps()
  }

  dispose(): void {
    this.root.unmount()
  }
}

export const a1Module: ArmModule = {
  id: 'a1-reactflow',

  mount(args: ArmMountArgs): Promise<ArmHandle> {
    return mountA1(args, null)
  },

  /**
   * The arm owns its React root, so a StrictMode probe mounted anywhere else sits in an
   * unrelated tree and can never observe whether THIS tree is double-invoking. Accepting the
   * probe as a child is the only way the question can be answered about the tree that is
   * actually being measured, so the arm exposes it rather than leaving the harness to report
   * an unverifiable result.
   */
  mountWithProbe(args: ArmMountArgs, probe: React.ReactNode): Promise<ArmHandle> {
    return mountA1(args, probe)
  },
}

async function mountA1(args: ArmMountArgs, probe: React.ReactNode): Promise<ArmHandle> {
  const { container, fixture, initialViewport, lodEnabled } = args
  const lod = createLodController(container, lodEnabled)
  // Read from the URL rather than threaded through ArmMountArgs: it is an arm-specific knob
  // being priced, not a property of the scenario, and every other arm would have to carry a
  // field that means nothing to it.
  const cull = new URLSearchParams(window.location.search).get(A1_CULL_QUERY_FLAG) === '1'

  const root = createRoot(container)
  const api = await new Promise<InternalApi>((resolve) => {
    root.render(
      <ReactFlowProvider>
        {probe}
        <Bridge
          fixture={fixture}
          initialViewport={initialViewport}
          lod={lod}
          cull={cull}
          onReady={resolve}
        />
      </ReactFlowProvider>,
    )
  })

  lod.update(initialViewport.zoom)
  return new A1Handle(root, container, fixture, lod, api)
}
