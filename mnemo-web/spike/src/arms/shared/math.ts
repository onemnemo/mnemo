/**
 * Fitting rendered LaTeX into a fixed box.
 *
 * Two details here are load-bearing and easy to get wrong, which is why both arms call this
 * rather than each doing the arithmetic themselves.
 *
 * **Measurement uses offsetWidth, not getBoundingClientRect.** The host sits under the
 * viewport's zoom transform, so a bounding rect reports screen pixels and the fit ratio comes
 * out wrong at every zoom except 1.0. Offset dimensions are layout values and ignore ancestor
 * transforms, which is exactly what a zoom-independent fit needs.
 *
 * **Scaling is downward only.** A small expression stays at its natural size and is centred; a
 * tall fraction shrinks rather than growing its node. Upscaling would be a spec violation, not
 * a cosmetic difference, so the clamp is on the multiplier itself.
 *
 * The caller owns the invariant that makes this safe: the OUTER box never changes size, so
 * content can never resize the node that measures it.
 */

import { renderMath } from '@/notes/editor/atoms/katex'

const PADDING = 4

export interface MathFit {
  readonly scale: number
  readonly natural: { readonly w: number; readonly h: number }
}

export function fitMathIntoBox(
  host: HTMLElement,
  latex: string,
  boxWidth: number,
  boxHeight: number,
): MathFit {
  // Reset before measuring: a stale transform from a previous render would not affect
  // offsetWidth, but the visual would flash at the old scale.
  host.style.transform = 'translate(-50%, -50%) scale(1)'
  renderMath(host, latex, latex)

  const naturalW = host.offsetWidth
  const naturalH = host.offsetHeight

  const boxW = Math.max(1, boxWidth - PADDING * 2)
  const boxH = Math.max(1, boxHeight - PADDING * 2)

  // A zero natural size means KaTeX produced nothing measurable, usually an empty source.
  // Scaling by a ratio against zero would produce Infinity, so it stays at 1.
  const scale =
    naturalW > 0 && naturalH > 0 ? Math.min(1, Math.min(boxW / naturalW, boxH / naturalH)) : 1

  host.style.transform = `translate(-50%, -50%) scale(${scale})`
  return { scale, natural: { w: naturalW, h: naturalH } }
}
