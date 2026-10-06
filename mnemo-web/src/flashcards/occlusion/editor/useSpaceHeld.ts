import { useEffect, useRef, useState, type RefObject } from "react"

import { isEditableTarget } from "@/keybinds/chord"

/** Controls that act on Space themselves, which keep it even while the pointer rests on the stage. */
function takesSpace(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a[href], select, summary, [role=button], [role=checkbox], [role=menuitem], [role=switch], [role=tab]") !== null
}

/**
 * Whether Space is held while the pointer is over the element, which turns a drag into a pan. A
 * Space typed into a field is the field's and does not count.
 */
export function useSpaceHeld(element: RefObject<HTMLElement | null>): boolean {
  const [held, setHeld] = useState(false)
  const over = useRef(false)

  useEffect(() => {
    const target = element.current
    if (!target) return
    const enter = () => {
      over.current = true
    }
    const leave = () => {
      over.current = false
    }
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditableTarget(event.target) || takesSpace(event.target) || !over.current) return
      event.preventDefault()
      setHeld(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setHeld(false)
    }
    const blur = () => setHeld(false)

    target.addEventListener("pointerenter", enter)
    target.addEventListener("pointerleave", leave)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => {
      target.removeEventListener("pointerenter", enter)
      target.removeEventListener("pointerleave", leave)
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
    }
  }, [element])

  return held
}
