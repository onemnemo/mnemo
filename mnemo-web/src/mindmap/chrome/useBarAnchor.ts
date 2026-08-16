/**
 * Keeps a floating bar over the thing it is about, on every frame, without telling React.
 *
 * The camera is deliberately silent while it moves: it writes the world transform straight to the
 * DOM and only reports a settled viewport a moment after a gesture ends. That is what makes a pan
 * cost nothing, and it means a bar positioned from React state would sit still for the whole pan and
 * then jump. So the bar follows the same split everything else over this canvas follows: React
 * decides whether it is up and what is on it, the DOM decides where it is.
 *
 * The point it tracks comes from the live scene index rather than from the projected scene, so a bar
 * over a node being dragged travels with the node instead of waiting for the drag to be committed.
 */

import { useLayoutEffect, useRef, type RefObject } from "react"

import type { CanvasRuntime } from "../canvas/runtime"
import type { SceneIndex } from "../canvas/scene-index"
import type { Point } from "../model/scene"
import { nextPlacement } from "./anchor"

/**
 * A ref this only ever reads.
 *
 * `RefObject` is mutable, so one holding a div is not one holding an element, and a hook that only
 * ever looks at what is in the box has no business demanding the exact type it was filled with.
 */
export type Held<T> = { readonly current: T | null }

export function useBarAnchor(
  runtime: Held<CanvasRuntime>,
  pane: Held<HTMLElement>,
  locate: (index: SceneIndex) => Point | null,
): RefObject<HTMLDivElement | null> {
  const bar = useRef<HTMLDivElement>(null)
  // Read through a ref rather than closed over, so a new closure per render does not tear the loop
  // down and start a fresh one sixty times a second while anything is selected.
  const live = useRef(locate)
  live.current = locate

  useLayoutEffect(() => {
    let frame = 0
    let last: Point | null = null

    const place = () => {
      frame = requestAnimationFrame(place)

      const node = bar.current
      const camera = runtime.current
      const host = pane.current
      if (!node || !camera || !host) {
        return
      }

      const next = nextPlacement({
        world: live.current(camera.index()),
        toPane: (point) => camera.toPane(point),
        // Offset sizes rather than a bounding rect, deliberately. The bar animates in with a scale,
        // and a rect read while that is running comes back shrunk, which would clamp the bar
        // against a width it is about to stop having. Offsets are layout, which a transform does
        // not touch.
        measure: () => ({
          bar: { width: node.offsetWidth, height: node.offsetHeight },
          pane: { width: host.clientWidth, height: host.clientHeight },
        }),
        last,
      })
      if (!next) {
        return
      }

      last = next.anchor
      node.style.left = `${next.at.x}px`
      node.style.top = `${next.at.y}px`
      // Held back until it has somewhere to be. The runtime is built in a passive effect, so on the
      // frame a scene is swapped there is briefly no camera to ask, and a bar drawn at the pane's
      // corner for that frame reads as a glitch rather than as a bar waiting.
      node.style.visibility = "visible"
    }

    // Once, synchronously, before the browser paints: the selection has just changed and the bar is
    // new, and waiting a frame for it would show it at the corner of the pane first.
    place()
    return () => cancelAnimationFrame(frame)
  }, [pane, runtime])

  return bar
}
