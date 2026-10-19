import { useCallback, useEffect, useRef } from "react"

/** How close to the scroller's top or bottom edge, in px, a drag starts scrolling it. */
const EDGE = 48
/** Scroll speed at the very edge, in px per frame. It eases off toward the inner side. */
const MAX_SPEED = 18

interface Drag {
  /** The state the rows in range take, the opposite of the first box's state. */
  value: boolean
  startIndex: number
  lastIndex: number
  /** The x the drag started at, so sideways drift still reads the same rows. */
  x: number
  y: number
  moved: boolean
  /** The selection before the press. Rows backed out of and Escape return to it. */
  before: ReadonlySet<string>
  scroller: HTMLElement | null
  frame: number
}

function scrollerOf(element: Element | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

/**
 * Swallows the click after a release so it cannot toggle the box under the pointer.
 * Called at the release so a click that never comes cannot eat the next one.
 */
function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => event.stopPropagation()
  window.addEventListener("click", swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0)
}

/** Swallows the click of a held press once it is released. A cancelled press has no click. */
function swallowClickOnRelease(): void {
  const end = (event: PointerEvent) => {
    window.removeEventListener("pointerup", end)
    window.removeEventListener("pointercancel", end)
    if (event.type === "pointerup") swallowNextClick()
  }
  window.addEventListener("pointerup", end)
  window.addEventListener("pointercancel", end)
}

/**
 * The checkbox column as a selection gutter. A drag from a box sets the rows it passes to the
 * state that box switches to. Escape restores the selection. Shift-click sets a range from
 * the last box pressed. A press that stays in its box is an ordinary click.
 */
export function useCheckboxDrag(
  ids: readonly string[],
  selected: ReadonlySet<string>,
  replace: (selected: ReadonlySet<string>) => void,
) {
  const drag = useRef<Drag | null>(null)
  const anchor = useRef<string | null>(null)
  const latest = useRef({ ids, selected, replace })
  latest.current = { ids, selected, replace }

  const stop = useRef<(cancel: boolean) => void>(() => {})

  /** The selection with rows between start and index set and every other row as it began. */
  const apply = useCallback((current: Drag, index: number) => {
    const { ids: list, replace: write } = latest.current
    const from = Math.min(current.startIndex, index)
    const to = Math.max(current.startIndex, index)
    const next = new Set(current.before)
    list.forEach((id, i) => {
      if (i < from || i > to) return
      if (current.value) next.add(id)
      else next.delete(id)
    })
    write(next)
  }, [])

  const track = useCallback(
    (clientY: number) => {
      const current = drag.current
      if (!current) return
      current.y = clientY
      const row = document.elementFromPoint(current.x, clientY)?.closest<HTMLElement>("[data-card-id]")
      const index = row ? latest.current.ids.indexOf(row.dataset.cardId ?? "") : -1
      if (index === -1 || index === current.lastIndex) return
      current.moved = true
      current.lastIndex = index
      apply(current, index)
    },
    [apply],
  )

  const autoScroll = useCallback(() => {
    const current = drag.current
    if (!current) return
    current.frame = requestAnimationFrame(autoScroll)
    const scroller = current.scroller
    if (!scroller || !current.moved) return
    const box = scroller.getBoundingClientRect()
    const above = box.top + EDGE - current.y
    const below = current.y - (box.bottom - EDGE)
    const step = above > 0 ? -above : below > 0 ? below : 0
    if (step === 0) return
    scroller.scrollTop += Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (step / EDGE) * MAX_SPEED))
    // The rows moved under a still pointer, so read the row under it again.
    track(Math.max(box.top + 1, Math.min(box.bottom - 1, current.y)))
  }, [track])

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!drag.current) return
      event.preventDefault()
      track(event.clientY)
    },
    [track],
  )
  const onPointerUp = useCallback(() => stop.current(false), [])
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key !== "Escape" || !drag.current) return
    event.preventDefault()
    event.stopPropagation()
    stop.current(true)
  }, [])

  stop.current = (cancel) => {
    const current = drag.current
    drag.current = null
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", onPointerUp)
    window.removeEventListener("pointercancel", onPointerUp)
    window.removeEventListener("keydown", onKeyDown, true)
    document.body.style.userSelect = ""
    if (!current) return
    cancelAnimationFrame(current.frame)
    if (cancel) {
      latest.current.replace(current.before)
      // Escape comes while the pointer is still down. The click comes with the release.
      swallowClickOnRelease()
    } else if (current.moved) swallowNextClick()
  }

  useEffect(() => () => stop.current(false), [])

  return useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return
      const strip = (event.target as Element).closest("[data-row-check]")
      const id = strip?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId
      const { ids: list, selected: current, replace: write } = latest.current
      const index = id ? list.indexOf(id) : -1
      if (!id || index === -1) return
      const value = !current.has(id)

      const from = anchor.current === null ? -1 : list.indexOf(anchor.current)
      if (event.shiftKey && from !== -1) {
        // A range from the last box pressed, set the way this box switches. The box's own
        // click is swallowed so it does not toggle back.
        event.preventDefault()
        const next = new Set(current)
        for (let i = Math.min(from, index); i <= Math.max(from, index); i++) {
          if (value) next.add(list[i])
          else next.delete(list[i])
        }
        write(next)
        anchor.current = id
        // The click arrives with the release, however long the press is held.
        swallowClickOnRelease()
        return
      }

      anchor.current = id
      drag.current = {
        value,
        startIndex: index,
        lastIndex: index,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        before: new Set(current),
        scroller: scrollerOf(strip ?? null),
        frame: 0,
      }
      document.body.style.userSelect = "none"
      window.addEventListener("pointermove", onPointerMove)
      window.addEventListener("pointerup", onPointerUp)
      window.addEventListener("pointercancel", onPointerUp)
      window.addEventListener("keydown", onKeyDown, true)
      drag.current.frame = requestAnimationFrame(autoScroll)
    },
    [autoScroll, onKeyDown, onPointerMove, onPointerUp],
  )
}
