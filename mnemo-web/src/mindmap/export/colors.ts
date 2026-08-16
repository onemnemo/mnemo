/**
 * Theme colours, flattened to literals.
 *
 * Everything on the canvas is painted in the theme's own language: a branch is `var(--branch-3)` and
 * the ring around a card is `color-mix(in oklab, var(--branch-3) 32%, transparent)`. Inside the app
 * those resolve against the document. In a file that leaves the app they resolve against nothing, and
 * a shape painted in a colour that resolves to nothing is a shape painted in no colour at all.
 *
 * So an export puts every colour through here first. Resolved by asking the browser rather than by
 * parsing, because a hand-written reading of color-mix in oklab would be a second opinion about what
 * the theme's colours are, free to disagree with the one on screen.
 */

/** Turns any CSS colour the app paints with into one any renderer can read. */
export interface ColorFlattener {
  /** The colour as `#rrggbb` or `rgba(...)`. Anything unreadable comes back untouched. */
  readonly flatten: (css: string) => string
  /** Takes the probe back out of the document. */
  readonly dispose: () => void
}

/**
 * A flattener bound to a document, so colours resolve against the theme that is actually on screen
 * rather than against whatever the stylesheet's defaults are.
 *
 * The probe has to be in the tree and it has to be somewhere the theme applies, since a custom
 * property is inherited and an element outside the document inherits nothing.
 */
export function createColorFlattener(host: HTMLElement = document.body): ColorFlattener {
  const cache = new Map<string, string>()

  const probe = document.createElement("span")
  probe.setAttribute("aria-hidden", "true")
  probe.style.cssText = "position:absolute;left:-9999px;top:0;width:0;height:0;pointer-events:none"
  host.appendChild(probe)

  let paint: CanvasRenderingContext2D | null | undefined

  const flatten = (css: string): string => {
    const known = cache.get(css)
    if (known !== undefined) {
      return known
    }

    const flat = resolve(css) ?? css
    cache.set(css, flat)
    return flat
  }

  const resolve = (css: string): string | null => {
    // An invalid value is dropped by the style declaration rather than stored, so the previous one
    // would answer for it. Clearing first is what turns that into a detectable miss.
    probe.style.color = ""
    probe.style.color = css
    if (probe.style.color === "") {
      return null
    }

    const computed = getComputedStyle(probe).color
    if (!computed) {
      return null
    }
    return toLiteral(computed)
  }

  /**
   * The computed colour, read back as pixels.
   *
   * Computed style hands back whichever space the colour was mixed in, so a branch wash arrives as
   * `oklab(...)` and a plain token as `rgb(...)`. Painting one pixel and reading it is the one path
   * that answers for both without this file having to know either syntax.
   */
  const toLiteral = (computed: string): string | null => {
    const ctx = context()
    if (!ctx) {
      return computed
    }

    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = "#000"
    ctx.fillStyle = computed
    ctx.fillRect(0, 0, 1, 1)

    let pixel: Uint8ClampedArray
    try {
      pixel = ctx.getImageData(0, 0, 1, 1).data
    } catch {
      return computed
    }

    const [r, g, b, a] = pixel
    if (a === 0) {
      return "none"
    }
    if (a === 255) {
      return `#${hex(r)}${hex(g)}${hex(b)}`
    }
    return `rgba(${r}, ${g}, ${b}, ${round(a / 255)})`
  }

  const context = (): CanvasRenderingContext2D | null => {
    if (paint === undefined) {
      const canvas = document.createElement("canvas")
      canvas.width = 1
      canvas.height = 1
      paint = canvas.getContext("2d", { willReadFrequently: true })
    }
    return paint
  }

  return {
    flatten,
    dispose: () => probe.remove(),
  }
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0")
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
