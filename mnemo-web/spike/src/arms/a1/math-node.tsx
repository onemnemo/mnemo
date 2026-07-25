import { memo, useEffect, useRef } from 'react'
import { renderMath } from '@/notes/editor/atoms/katex'
import type { MathContent } from '../../fixture/model'

/**
 * A node whose content is live LaTeX, fitted into a fixed box.
 *
 * Two things here are load-bearing and easy to get wrong.
 *
 * **The outer box never changes size.** Its width and height come from the element, and
 * the KaTeX host is absolutely positioned inside it. React Flow measures nodes with a
 * ResizeObserver, so content that could resize its own node would feed a measurement back
 * into the layout that produced it. Pinning the box makes that structurally impossible
 * rather than merely unlikely.
 *
 * **Measurement uses offsetWidth, not getBoundingClientRect.** The node sits under the
 * viewport's zoom transform, so a bounding rect would report screen pixels and the fit
 * ratio would come out wrong at every zoom except 1.0. Offset dimensions are layout
 * values and ignore ancestor transforms, which is exactly what a zoom-independent fit
 * needs.
 *
 * Scaling is downward only. A small expression stays at its natural size and is centred;
 * a tall fraction shrinks rather than growing its node. Upscaling would be a spec
 * violation, not a cosmetic difference, so the clamp is on the multiplier itself.
 */

export interface MathNodeData {
  readonly content: MathContent
  readonly width: number
  readonly height: number
  readonly onMeasured?: (id: string, scale: number, natural: { w: number; h: number }) => void
  readonly id: string
}

const PADDING = 4

function MathNodeImpl({ data }: { data: MathNodeData }): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Reset before measuring: a stale transform from a previous render would be baked
    // into nothing (offsetWidth ignores it), but the visual would flash at the old scale.
    host.style.transform = 'translate(-50%, -50%) scale(1)'
    renderMath(host, data.content.latex, data.content.latex)

    const naturalW = host.offsetWidth
    const naturalH = host.offsetHeight

    const boxW = Math.max(1, data.width - PADDING * 2)
    const boxH = Math.max(1, data.height - PADDING * 2)

    // A zero natural size means KaTeX produced nothing measurable, usually an empty
    // source. Scaling by a ratio against zero would produce Infinity, so it stays at 1.
    const scale =
      naturalW > 0 && naturalH > 0
        ? Math.min(1, Math.min(boxW / naturalW, boxH / naturalH))
        : 1

    host.style.transform = `translate(-50%, -50%) scale(${scale})`
    data.onMeasured?.(data.id, scale, { w: naturalW, h: naturalH })
  }, [data])

  return (
    <div className="spike-node spike-math">
      <div ref={hostRef} className="spike-math-host" />
    </div>
  )
}

export const MathNode = memo(MathNodeImpl)
