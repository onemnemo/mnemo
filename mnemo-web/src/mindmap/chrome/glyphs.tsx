/**
 * The little diagrams the style controls are made of.
 *
 * None of these are icons, which is why none of them go through the icon registry: each one is a
 * sample of the thing it sets, drawn by the same rules the canvas draws it by. That is the only way a
 * picker can be trusted to show what you are about to get, and it is why they live in one file rather
 * than being redrawn inside each control that needs them. The flyout that arms a tool and the bar
 * that restyles a finished edge show the identical picture for the identical value.
 */

import { cn } from "@/lib/utils"

import type {
  ArrowCap,
  CanvasBackground,
  EdgeRouting,
  FontScale,
  LayoutAlgorithm,
  LineStyle,
  NodeShape,
} from "../model/document"
import type { BranchMaterial } from "./material"

export function LineGlyph({ line }: { line: LineStyle }) {
  if (line === "double") {
    return (
      <svg width={22} height={12} aria-hidden>
        <path d="M1 4.5 H21 M1 7.5 H21" stroke="currentColor" strokeWidth={1.3} fill="none" />
      </svg>
    )
  }
  return (
    <svg width={22} height={12} aria-hidden>
      <path
        d="M1 6 H21"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeDasharray={line === "dashed" ? "5 3" : line === "dotted" ? "0.5 3" : undefined}
        fill="none"
      />
    </svg>
  )
}

export function RouteGlyph({ routing }: { routing: EdgeRouting }) {
  const d =
    routing === "curve"
      ? "M1 11 C8 11 8 1 21 1"
      : routing === "straight"
        ? "M1 11 L21 1"
        : "M1 11 H11 V1 H21"
  return (
    <svg width={22} height={12} aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

/**
 * A cap on the end of a stub of line.
 *
 * Mirrored rather than redrawn for the start end, so the two ends of an edge are visibly the same
 * three choices pointing opposite ways rather than six unrelated buttons.
 */
export function CapGlyph({ cap, flipped }: { cap: ArrowCap; flipped?: boolean }) {
  return (
    <svg width={20} height={12} aria-hidden transform={flipped ? "scale(-1, 1)" : undefined}>
      <path d="M2 6 H14" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" fill="none" />
      {cap === "arrow" ? <path d="M12 2.5 L18 6 L12 9.5 Z" fill="currentColor" /> : null}
      {cap === "dot" ? <circle cx={15} cy={6} r={2.6} fill="currentColor" /> : null}
    </svg>
  )
}

/**
 * One rung of the loudness ladder.
 *
 * Card and outline are the same box with and without a fill, because that is the whole difference
 * between them on the canvas too. Plain is drawn as words over a rule rather than as an empty box,
 * since a plain node has no box at all and showing one would be the wrong promise.
 */
export function NodeShapeGlyph({ shape }: { shape: NodeShape }) {
  if (shape === "plain") {
    return (
      <svg width={22} height={12} aria-hidden>
        <path d="M5 5 H17" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" opacity={0.45} />
        <path d="M2 9.5 H20" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width={22} height={12} aria-hidden>
      <rect
        x={1.5}
        y={2.5}
        width={19}
        height={7}
        rx={shape === "pill" ? 3.5 : 2}
        fill={shape === "outline" ? "none" : "currentColor"}
        fillOpacity={0.18}
        stroke="currentColor"
        strokeWidth={1.2}
      />
    </svg>
  )
}

/** Sizes on the same table the measurer uses, so the four buttons step the way the canvas steps. */
const SCALE_PX: Record<FontScale, number> = { s: 9.5, m: 11.5, l: 13.5, xl: 16 }

/**
 * The size control's own sample, as a letter rather than a glyph.
 *
 * Type is the thing being set, so the button is set in it. Line height is pinned so four different
 * sizes still sit on one baseline inside a fixed slot.
 */
export function ScaleGlyph({ scale }: { scale: FontScale }) {
  return (
    <span
      className="font-semibold leading-none"
      style={{ fontSize: SCALE_PX[scale] }}
      aria-hidden
    >
      A
    </span>
  )
}

/**
 * A shape of map, in twenty pixels.
 *
 * Each one is the arrangement's own idea rather than a picture of a particular map: where the root
 * goes and which way the children run is the whole difference between them, and the difference is
 * what a picker has to show.
 */
export function LayoutGlyph({ algorithm }: { algorithm: LayoutAlgorithm }) {
  const dot = (x: number, y: number, r = 1.7) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="currentColor" />
  const line = (d: string) => <path key={d} d={d} stroke="currentColor" strokeWidth={1} fill="none" opacity={0.5} />

  const parts: Record<LayoutAlgorithm, React.ReactNode[]> = {
    balanced: [
      line("M11 8 H4 M11 8 H18"),
      dot(11, 8, 2.2),
      dot(4, 4),
      dot(4, 12),
      dot(18, 4),
      dot(18, 12),
    ],
    treeRight: [line("M4 8 H16"), dot(4, 8, 2.2), dot(16, 3), dot(16, 8), dot(16, 13)],
    treeDown: [line("M11 3 V13"), dot(11, 3, 2.2), dot(4, 13), dot(11, 13), dot(18, 13)],
    radial: [
      line("M11 8 L4 4 M11 8 L18 4 M11 8 L4 12 M11 8 L18 12"),
      dot(11, 8, 2.2),
      dot(4, 4),
      dot(18, 4),
      dot(4, 12),
      dot(18, 12),
    ],
    timeline: [line("M3 8 H19"), dot(3, 8, 2.2), dot(8, 8), dot(13, 8), dot(18, 8)],
    // Nowhere in particular, which is the point: free is the arrangement that leaves a map alone.
    free: [dot(5, 5), dot(15, 4), dot(9, 11), dot(18, 11)],
  }

  return (
    <svg width={22} height={16} aria-hidden>
      {parts[algorithm]}
    </svg>
  )
}

/** How a branch is drawn along its length: a stroke, a tapering ribbon, or a right-angle run. */
export function BranchGlyph({ material }: { material: BranchMaterial }) {
  if (material === "taper") {
    return (
      <svg width={22} height={16} aria-hidden>
        <path d="M2 12 C8 12 10 4 20 3.4 L20 5.4 C10 6 8 13.4 2 13.4 Z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width={22} height={16} aria-hidden>
      <path
        d={material === "step" ? "M2 12 H11 V4 H20" : "M2 12 C8 12 10 4 20 4"}
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

/** What the map sits on. */
export function BackgroundGlyph({ background }: { background: CanvasBackground }) {
  if (background === "plain") {
    return (
      <svg width={22} height={16} aria-hidden>
        <rect x={2} y={2} width={18} height={12} rx={2} stroke="currentColor" strokeWidth={1.2} fill="none" />
      </svg>
    )
  }
  if (background === "grid") {
    return (
      <svg width={22} height={16} aria-hidden>
        <path
          d="M2 6 H20 M2 10 H20 M7 2 V14 M12 2 V14 M17 2 V14"
          stroke="currentColor"
          strokeWidth={1}
          opacity={0.75}
        />
      </svg>
    )
  }
  return (
    <svg width={22} height={16} aria-hidden>
      {[4, 9, 14].map((y) => [4, 9, 14, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1} fill="currentColor" />))}
    </svg>
  )
}

/** One branch hue, as the ring it will actually draw with. */
export function SwatchGlyph({ color, active }: { color: string; active: boolean }) {
  return (
    <span
      className={cn(
        "block size-4 rounded-full transition-transform duration-120",
        active && "scale-110 ring-2 ring-ink ring-offset-2 ring-offset-canvas",
      )}
      style={{ background: color }}
      aria-hidden
    />
  )
}
