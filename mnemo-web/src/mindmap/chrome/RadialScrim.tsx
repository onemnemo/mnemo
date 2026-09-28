import { MOST_CUTOUTS } from "./radial"

export interface PaneBox {
  x: number
  y: number
  width: number
  height: number
}

const PAD = 8
const RADIUS = 10

/** A far-off rectangle standing for the whole pane, so the path needs no size of its own; the SVG clips it. */
const EVERYWHERE = "M-100000 -100000 H100000 V100000 H-100000 Z"

function roundRect({ x, y, width, height }: PaneBox): string {
  const left = x - PAD
  const top = y - PAD
  const w = width + PAD * 2
  const h = height + PAD * 2
  const r = Math.min(RADIUS, w / 2, h / 2)
  return [
    `M${left + r} ${top}`,
    `H${left + w - r}`,
    `A${r} ${r} 0 0 1 ${left + w} ${top + r}`,
    `V${top + h - r}`,
    `A${r} ${r} 0 0 1 ${left + w - r} ${top + h}`,
    `H${left + r}`,
    `A${r} ${r} 0 0 1 ${left} ${top + h - r}`,
    `V${top + r}`,
    `A${r} ${r} 0 0 1 ${left + r} ${top}`,
    "Z",
  ].join(" ")
}

/** The scrim under the ring, with the selection cut out of it so the thing the ring acts on stays readable. */
export function RadialScrim({ cutouts }: { cutouts: readonly PaneBox[] }) {
  const holes = cutouts.length > MOST_CUTOUTS ? [] : cutouts
  return (
    <svg className="absolute inset-0 size-full animate-fade-in" aria-hidden>
      <path
        d={[EVERYWHERE, ...holes.map(roundRect)].join(" ")}
        fillRule="evenodd"
        style={{ fill: "color-mix(in srgb, var(--canvas) 60%, transparent)" }}
      />
    </svg>
  )
}
