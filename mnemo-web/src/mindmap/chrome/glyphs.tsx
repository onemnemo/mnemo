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

import type { ArrowCap, EdgeRouting, FontScale, LineStyle, NodeShape } from "../model/document"

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
