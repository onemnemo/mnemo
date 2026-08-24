import { useEffect } from "react"

import { isNativeWindow, reportDragRegions, type DragRect } from "@/lib/window"

/**
 * Publishes the shell's drag surfaces and their interactive exclusions as the
 * window's native drag and no-drag regions. Mounted once, in App.
 *
 * The source of truth is the same markup the `app-region` stylesheet rules read:
 * `.drag-region` elements are drag surfaces, and their `button`, `a` and `input`
 * descendants plus any `.no-drag` element are carved back out, so Linux (the one
 * platform whose engine ignores `app-region`) behaves like the ones that honour
 * it. Floating layers are carved without opt-in: while anything modal
 * (`aria-modal`) is open every scrim already blocks the titlebar on the other
 * platforms, so dragging is suspended entirely, and popped-out panels
 * (`data-radix-popper-content-wrapper`) carve their own outline. Purely visual
 * floats do not count: anything with `pointer-events: none` never takes a press,
 * so punching a hole for it would only make a spot of the bar inert.
 *
 * Stacked chrome can overlap (the onboarding screen draws its strip over the
 * shell's), and that is safe by construction: a control publishes no-drag, no-drag
 * wins, and a stale hole only ever falls through to the page. Publishing is
 * coalesced to one frame and skipped when nothing moved, so quiet frames cost a
 * comparison and no message.
 */
export function useDragRegions(): void {
  useEffect(() => {
    // Without a bridge there is no native window to inform, and in a plain
    // browser tab nothing reads these rectangles at all.
    if (!isNativeWindow) return

    let frame = 0
    let lastPublished = ""
    const resizeObserver = new ResizeObserver(schedule)
    const observed = new Set<Element>()

    function clamped(element: Element): DragRect | null {
      const style = getComputedStyle(element)
      if (style.pointerEvents === "none" || style.visibility === "hidden") return null

      const box = element.getBoundingClientRect()
      // Rounded outward so a control never loses its edge pixel to rounding;
      // where a widened drag rect overlaps one, no-drag precedence settles it.
      const x = Math.max(0, Math.floor(box.left))
      const y = Math.max(0, Math.floor(box.top))
      const w = Math.min(window.innerWidth, Math.ceil(box.right)) - x
      const h = Math.min(window.innerHeight, Math.ceil(box.bottom)) - y
      return w > 0 && h > 0 ? { x, y, w, h } : null
    }

    function collect(): { drag: DragRect[]; noDrag: DragRect[] } {
      for (const modal of document.querySelectorAll('[aria-modal="true"]')) {
        if (clamped(modal)) return { drag: [], noDrag: [] }
      }

      const drag: DragRect[] = []
      const noDrag: DragRect[] = []
      const surfaces = document.querySelectorAll<HTMLElement>(".drag-region")

      for (const surface of surfaces) {
        const rect = clamped(surface)
        if (!rect) continue
        drag.push(rect)
        // The same descendants index.css opts out of `app-region: drag`.
        for (const control of surface.querySelectorAll("button, a, input")) {
          const carved = clamped(control)
          if (carved) noDrag.push(carved)
        }
      }

      for (const element of document.querySelectorAll(".no-drag, [data-radix-popper-content-wrapper]")) {
        const carved = clamped(element)
        if (carved) noDrag.push(carved)
      }

      return { drag, noDrag }
    }

    function publish(): void {
      frame = 0

      const regions = collect()
      const key = JSON.stringify(regions)
      if (key !== lastPublished) {
        lastPublished = key
        reportDragRegions(regions.drag, regions.noDrag)
      }

      // Re-anchor the observer on the surfaces that exist right now, so a bar
      // that mounts later (the onboarding strip) is watched from its first frame.
      const current = new Set<Element>([document.documentElement, ...document.querySelectorAll(".drag-region")])
      for (const element of observed) {
        if (!current.has(element)) {
          resizeObserver.unobserve(element)
          observed.delete(element)
        }
      }
      for (const element of current) {
        if (!observed.has(element)) {
          resizeObserver.observe(element)
          observed.add(element)
        }
      }
    }

    function schedule(): void {
      if (!frame) frame = requestAnimationFrame(publish)
    }

    publish()

    // Class changes and portal mounts move surfaces and floats; per-frame hover
    // styling does not touch class attributes here, so this stays quiet.
    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    })
    window.addEventListener("resize", schedule)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener("resize", schedule)
    }
  }, [])
}
