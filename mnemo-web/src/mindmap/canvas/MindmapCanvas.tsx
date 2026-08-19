import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

import { cn } from "@/lib/utils"

import "./mindmap-lod.css"
import "./mindmap-motion.css"

import { initialHybridMode } from "./edge-strategy"
import type { EdgeMode } from "./edge-style"
import { MindmapBackground } from "./MindmapBackground"
import { MindmapEdgeLabels, MindmapEdgeLayer } from "./MindmapEdgeLayer"
import { createSelectionRepainter } from "./edge-highlight"
import { MindmapSelectionLayer } from "./MindmapSelectionLayer"
import { MindmapNode } from "./MindmapNode"
import { createCanvasRuntime, type CanvasRuntime } from "./runtime"
import { installInteraction, type MovedElement, type NodeChrome } from "../interaction/controller"
import type { ResizeBox } from "../interaction/resize"
import { EMPTY_SELECTION, type Selection } from "../interaction/selection"
import { cursorFor, type MindmapTool } from "../interaction/tool"
import type { Point, Scene, Viewport } from "../model/scene"

const NO_SUBTREE: readonly string[] = []

export interface MindmapCanvasProps {
  scene: Scene
  /**
   * Filled with the live runtime so page chrome can drive the camera without owning it. A plain ref
   * object rather than an imperative handle: the runtime is created in an effect and torn down with
   * the scene, and a handle would have to be told about both.
   */
  runtimeRef?: RefObject<CanvasRuntime | null>
  selection?: Selection
  onSelection?: (next: Selection) => void
  /** One gesture, one call, with every element's final position. */
  onCommitMove?: (moves: readonly MovedElement[]) => void
  /** A resize grip was let go somewhere that means a different box. */
  onCommitResize?: (id: string, box: ResizeBox) => void
  /** A double click, which is how a label asks to be edited. */
  onActivate?: (id: string) => void
  /** The node whose label is currently a field. */
  editingId?: string | null
  /** The field closed: the typed text, or null when the edit was abandoned. */
  onEditEnd?: (id: string, text: string | null) => void
  /** The edge whose label is currently a field. */
  editingEdgeId?: string | null
  onEdgeLabelEnd?: (id: string, text: string | null) => void
  /** Descendants in the hierarchy, from the document rather than the scene. See the controller. */
  subtreeOf?: (id: string) => readonly string[]
  /** What a press means. Select unless the dock says otherwise. */
  tool?: MindmapTool
  /** An armed creation tool was used on empty canvas. */
  onPlant?: (tool: MindmapTool, at: Point) => void
  /** A sweep with the frame tool armed caught these. */
  onGroup?: (ids: readonly string[]) => void
  /** A connect drag landed on a node. */
  onConnect?: (fromId: string, toId: string) => void
  /** A node's own chrome was pressed: a task's box, or a reference's mark. */
  onChrome?: (id: string, part: NodeChrome) => void
  /** The camera moved, this frame. Drives the minimap; a zoom readout wants onCameraSettled. */
  onCamera?: (viewport: Viewport) => void
  /** The camera stopped moving, for a zoom readout. Never per frame. */
  onCameraSettled?: (viewport: Viewport) => void
  /** A Fit hit the camera's floor: the map is too large to show whole, even at the lowest zoom. */
  onFitClamped?: () => void
  className?: string
}

/**
 * The map on screen.
 *
 * React draws this once per scene and then gets out of the way. Everything that happens at pointer
 * rate, the camera, the culling, the level-of-detail bands and a drag's positions, is written to the
 * DOM by the runtime and the interaction controller, because a pan that costs a render is a pan that
 * stops being sixty a second somewhere around a thousand nodes.
 *
 * The one thing React does keep is which edge substrate is up. Canvas draws the edges at readable
 * zoom and SVG draws them at overview zoom, each used only where it was measured to work, and the
 * inactive one is unmounted rather than hidden: both of their failures come from the layer merely
 * existing, so a hidden layer would carry exactly the cost the switch exists to avoid. That crossing
 * happens at a zoom threshold with hysteresis, which is rare enough to be worth a render.
 */
export function MindmapCanvas({
  scene,
  runtimeRef,
  selection = EMPTY_SELECTION,
  onSelection,
  onCommitMove,
  onCommitResize,
  onActivate,
  editingId,
  onEditEnd,
  editingEdgeId,
  onEdgeLabelEnd,
  subtreeOf,
  tool = "select",
  onPlant,
  onGroup,
  onConnect,
  onChrome,
  onCamera,
  onCameraSettled,
  onFitClamped,
  className,
}: MindmapCanvasProps) {
  const pane = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const edgeCamera = useRef<SVGGElement | null>(null)
  const edgeCanvas = useRef<HTMLCanvasElement | null>(null)
  const overlayCamera = useRef<SVGGElement | null>(null)
  const background = useRef<HTMLDivElement>(null)
  const runtime = useRef<CanvasRuntime | null>(null)
  // Where the camera was when the last scene was torn down. Every edit reprojects, which rebuilds
  // the runtime, and a runtime that fits on creation would reframe the whole map every time anyone
  // moved a node. Fitting is a thing the user asks for, not a thing an edit does.
  const camera = useRef<{ id: string; viewport: Viewport } | null>(null)

  // Read by the controller at press time rather than captured when it was installed, which is once
  // per scene and would otherwise pin it to whatever was selected then.
  const live = useRef({
    selection,
    onSelection,
    onCommitMove,
    onCommitResize,
    onActivate,
    subtreeOf,
    tool,
    onPlant,
    onGroup,
    onConnect,
    onChrome,
    onCamera,
    onCameraSettled,
    onFitClamped,
  })
  live.current = {
    selection,
    onSelection,
    onCommitMove,
    onCommitResize,
    onActivate,
    subtreeOf,
    tool,
    onPlant,
    onGroup,
    onConnect,
    onChrome,
    onCamera,
    onCameraSettled,
    onFitClamped,
  }

  // Starts wherever a camera at 1:1 belongs, which is where every runtime starts before it fits.
  const [edgeMode, setEdgeMode] = useState<EdgeMode>(() => initialHybridMode(1))

  // Rebuilt whenever the scene identity changes, because the index reads the DOM React just wrote and
  // the culler's grid is built from it. Both are snapshots by design: making them incremental is the
  // work an edit path does, not something a remount should be doing.
  useEffect(() => {
    if (!pane.current || !world.current) {
      return
    }

    const created = createCanvasRuntime({
      scene,
      edgeMode,
      elements: {
        pane: pane.current,
        world: world.current,
        edgeCamera: edgeCamera.current,
        edgeCanvas: edgeCanvas.current,
        background: background.current,
        overlayCamera,
      },
      onEdgeMode: setEdgeMode,
      onCameraChange: (next) => live.current.onCamera?.(next),
      onCameraSettled: (next) => live.current.onCameraSettled?.(next),
      onFitClamped: () => live.current.onFitClamped?.(),
    })
    runtime.current = created
    if (runtimeRef) {
      runtimeRef.current = created
    }
    // A different map gets framed; the same map carries on from wherever it was being looked at.
    if (camera.current?.id === scene.id) {
      created.setViewport(camera.current.viewport)
    } else {
      created.fit()
    }
    // The ring is an attribute the index writes and remembers, so a fresh index believes nothing is
    // selected while the attributes from the last one are still on the hosts React reused. It then
    // has nothing to clear when the selection next changes, and the old ring never goes away.
    created.index().setSelected([...live.current.selection.elements])

    const repaintSelection = createSelectionRepainter(scene, (id) => created.index().boxOf(id))
    const installed = installInteraction(
      {
        pane: pane.current,
        index: created.index(),
        scene,
        subtreeOf: (id) => live.current.subtreeOf?.(id) ?? NO_SUBTREE,
        toCanvas: (x, y) => created.toCanvas(x, y),
        toPane: (point) => created.toPane(point),
        zoom: () => created.viewport().zoom,
        redraw: (movedEdgeIds) => {
          created.redraw(movedEdgeIds)
          repaintSelection(overlayCamera.current)
        },
        pin: (elementIds, edgeIds) => created.pin(elementIds, edgeIds),
        unpin: () => created.unpin(),
      },
      {
        selection: () => live.current.selection,
        setSelection: (next) => live.current.onSelection?.(next),
        tool: () => live.current.tool,
        commitMove: (moves) => live.current.onCommitMove?.(moves),
        commitResize: (id, box) => live.current.onCommitResize?.(id, box),
        activate: (id) => live.current.onActivate?.(id),
        plant: (armed, at) => live.current.onPlant?.(armed, at),
        group: (ids) => live.current.onGroup?.(ids),
        connect: (fromId, toId) => live.current.onConnect?.(fromId, toId),
        chrome: (id, part) => live.current.onChrome?.(id, part),
      },
    )
    created.cancelGesture = installed.cancel

    return () => {
      installed.uninstall()
      camera.current = { id: scene.id, viewport: created.viewport() }
      created.dispose()
      runtime.current = null
      if (runtimeRef) {
        runtimeRef.current = null
      }
    }
    // Deliberately not on edgeMode: a swap must not tear the runtime down and lose the camera. The
    // runtime is told about the new layer by the effect below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, runtimeRef])

  // Layout rather than passive, so the new substrate is drawing before the browser paints the frame
  // the swap happened on; otherwise the edges blink out for one frame at every threshold crossing.
  useLayoutEffect(() => {
    runtime.current?.rebindEdges({ edgeCamera: edgeCamera.current, edgeCanvas: edgeCanvas.current })
  }, [edgeMode])

  // The ring is an attribute on the host, not a prop, so selecting a node costs one attribute write
  // rather than a render of the element it is on. Not keyed on the scene: a new scene brings a new
  // index, and that one is told by the effect that made it.
  useLayoutEffect(() => {
    runtime.current?.index().setSelected([...selection.elements])
  }, [selection])

  // The overlay mounts after the camera was last applied, so it would sit at the origin until the
  // next pan. Its transform is the runtime's to write, and this is the moment to ask for it.
  useLayoutEffect(() => {
    runtime.current?.redraw()
  }, [selection.edges])

  // A field that closes takes the focus with it, and it lands on the body. Every key the map
  // answers would then do nothing until someone clicked the canvas again, which is the whole
  // outliner rhythm of Tab, type, Enter, Tab broken at the second Tab.
  const wasEditing = useRef<string | null>(null)
  useEffect(() => {
    if (wasEditing.current && !editingId) {
      pane.current?.focus({ preventScroll: true })
    }
    wasEditing.current = editingId ?? null
  }, [editingId])

  return (
    <div
      ref={pane}
      // The cursor is on the pane rather than per element, so an armed tool reads the same over a
      // node as over the space between two of them.
      className={cn(
        "relative size-full select-none overflow-hidden bg-canvas outline-none",
        cursorFor(tool),
        className,
      )}
      // The pane takes focus so the map answers the keyboard without a click landing on a node
      // first, and so Escape has somewhere to be heard. No focus ring: it is focused for the whole
      // time the map is open, and a permanent line across the top of the canvas is not information.
      tabIndex={0}
    >
      <MindmapBackground ref={background} background={scene.background} />

      {edgeMode === "canvas" ? (
        <canvas ref={edgeCanvas} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
      ) : null}

      {edgeMode === "svg" ? (
        <MindmapEdgeLayer
          scene={scene}
          cameraRef={(node) => {
            edgeCamera.current = node
          }}
        />
      ) : null}

      <MindmapSelectionLayer scene={scene} edgeIds={selection.edges} cameraRef={overlayCamera} />

      <div ref={world} className="mm-world absolute left-0 top-0 origin-top-left">
        {scene.elements.map((element) => (
          <MindmapNode
            key={element.id}
            element={element}
            editing={element.id === editingId}
            onEditEnd={onEditEnd}
          />
        ))}
        <MindmapEdgeLabels scene={scene} editingId={editingEdgeId} onEditEnd={onEdgeLabelEnd} />
      </div>
    </div>
  )
}
