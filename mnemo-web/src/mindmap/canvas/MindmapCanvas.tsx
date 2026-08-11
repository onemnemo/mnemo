import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

import { initialHybridMode } from "./edge-strategy"
import type { EdgeMode } from "./edge-style"
import { MindmapBackground } from "./MindmapBackground"
import { MindmapEdgeLabels, MindmapEdgeLayer } from "./MindmapEdgeLayer"
import { MindmapNode } from "./MindmapNode"
import { createCanvasRuntime, type CanvasRuntime } from "./runtime"
import type { Scene } from "../model/scene"

/**
 * The map on screen.
 *
 * React draws this once per scene and then gets out of the way. Everything that happens at pointer
 * rate, the camera, the culling and the level-of-detail bands, is written to the DOM by the runtime,
 * because a pan that costs a render is a pan that stops being sixty a second somewhere around a
 * thousand nodes.
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
  className,
}: {
  scene: Scene
  /**
   * Filled with the live runtime so page chrome can drive the camera without owning it. A plain ref
   * object rather than an imperative handle: the runtime is created in an effect and torn down with
   * the scene, and a handle would have to be told about both.
   */
  runtimeRef?: RefObject<CanvasRuntime | null>
  className?: string
}) {
  const pane = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const edgeCamera = useRef<SVGGElement | null>(null)
  const edgeCanvas = useRef<HTMLCanvasElement | null>(null)
  const background = useRef<HTMLDivElement>(null)
  const runtime = useRef<CanvasRuntime | null>(null)

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
      },
      onEdgeMode: setEdgeMode,
    })
    runtime.current = created
    if (runtimeRef) {
      runtimeRef.current = created
    }
    created.fit()

    return () => {
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

  return (
    <div
      ref={pane}
      className={`relative size-full overflow-hidden bg-canvas ${className ?? ""}`}
      // The pane takes focus so the map answers the keyboard without a click landing on a node
      // first, and so Escape has somewhere to be heard.
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

      <div ref={world} className="absolute left-0 top-0 origin-top-left will-change-transform">
        {scene.elements.map((element) => (
          <MindmapNode key={element.id} element={element} />
        ))}
        <MindmapEdgeLabels scene={scene} />
      </div>
    </div>
  )
}
