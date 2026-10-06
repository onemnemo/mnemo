import { useEffect, useRef, useState, type RefObject, type TransitionEvent } from "react"

export interface Exit<T> {
  /** The latest value, kept while the element fades out after the value went away. */
  shown: T | null
  /** True from the moment the value goes away until the fade has finished. */
  leaving: boolean
  ref: RefObject<HTMLDivElement | null>
  onTransitionEnd: (event: TransitionEvent) => void
}

/**
 * Keeps something mounted while its fade-out runs; `leaving` tells the element to fade. Values
 * compare field by field. It unmounts when the transition ends, or after its duration if no end event comes.
 */
export function useExit<T extends object>(value: T | null): Exit<T> {
  const [kept, setKept] = useState<T | null>(value)
  const ref = useRef<HTMLDivElement>(null)
  if (value !== null && !sameFields(value, kept)) setKept(value)

  const leaving = value === null && kept !== null
  useEffect(() => {
    if (!leaving) return
    const seconds = parseFloat(ref.current ? getComputedStyle(ref.current).transitionDuration : "0")
    if (!(seconds > 0)) return setKept(null)
    // A hidden pane or an interrupted transition never reports its end.
    const timer = window.setTimeout(() => setKept(null), seconds * 1000 + 50)
    return () => window.clearTimeout(timer)
  }, [leaving])

  return {
    shown: value ?? kept,
    leaving,
    ref,
    onTransitionEnd: (event) => {
      if (leaving && event.target === event.currentTarget && event.propertyName === "opacity") setKept(null)
    },
  }
}

function sameFields(a: object, b: object | null): boolean {
  if (!b) return false
  const left = Object.entries(a)
  return left.length === Object.keys(b).length && left.every(([key, value]) => (b as Record<string, unknown>)[key] === value)
}
