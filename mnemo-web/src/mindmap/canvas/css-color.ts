/**
 * CSS custom properties, resolved to something a canvas can paint with.
 *
 * The scene stores colours as `var(--branch-3)` on purpose: a variable re-resolves when the theme
 * attribute flips, so switching from light to dark repaints the whole map without React rendering
 * anything. A 2D context cannot do that. Assigning a `var()` to `strokeStyle` is not an error either,
 * it is silently ignored, so the canvas keeps whatever colour it had and the map draws in one flat
 * shade with nothing in the console to say why.
 *
 * So the variable stays the scene's answer, and this resolves it for the one consumer that needs a
 * literal. Cached, because the resolution is a `getComputedStyle` read and the canvas asks per edge
 * per frame; invalidated on a theme change, because that is exactly when the answer changes.
 */

const VAR = /^var\(\s*(--[\w-]+)\s*\)$/

export interface CssColorResolver {
  /** A colour a canvas can use. Anything that is not a bare `var()` is handed back untouched. */
  resolve(color: string): string
  /** The theme moved; every cached answer is now wrong. */
  invalidate(): void
}

export function createCssColorResolver(root: HTMLElement = document.documentElement): CssColorResolver {
  const cache = new Map<string, string>()

  const resolve = (color: string): string => {
    const hit = cache.get(color)
    if (hit !== undefined) {
      return hit
    }

    const match = VAR.exec(color)
    // A computed value can itself be a var() chain or a color-mix; getPropertyValue resolves the
    // chain but leaves the function, which a canvas handles for color-mix and not for var. One more
    // pass covers the alias case without turning this into a CSS evaluator.
    let value = match ? getComputedStyle(root).getPropertyValue(match[1]).trim() : color
    const nested = VAR.exec(value)
    if (nested) {
      value = getComputedStyle(root).getPropertyValue(nested[1]).trim()
    }

    const resolved = value || color
    cache.set(color, resolved)
    return resolved
  }

  // No observer here on purpose: the caller already has to redraw when the theme changes, and one
  // watcher that both clears this and repaints is easier to reason about than two that race.
  return {
    resolve,
    invalidate: () => cache.clear(),
  }
}
