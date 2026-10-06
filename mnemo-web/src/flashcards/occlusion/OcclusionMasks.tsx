import { memo, type CSSProperties } from "react"

import { glyphSize, polygonPoints } from "./geometry"
import type { MaskState, PlacedMask } from "./placement"

const REVEAL = "var(--duration-reveal)"
const CONCEAL = "var(--duration-conceal)"

/** Fading in uses the quick token and fading back to covered the slower one, so a mask never flickers. */
function fade(state: MaskState): string {
  return state === "covered" ? CONCEAL : REVEAL
}

function boxStyle(state: MaskState, ellipse: boolean, heightPx: number): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    borderRadius: ellipse ? "50%" : state === "answer" ? 4 : 3,
    transitionProperty: "background-color, box-shadow",
    transitionDuration: fade(state),
  }
  if (state === "asked") {
    return {
      ...base,
      background: "var(--accent-paper-asked)",
      boxShadow: "inset 0 0 0 2px var(--paper-ink), 0 0 0 2px var(--paper)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--paper-fg)",
      fontWeight: 600,
      lineHeight: 1,
      fontSize: glyphSize(heightPx),
    }
  }
  if (state === "answer") {
    return { ...base, background: "transparent", boxShadow: "0 0 0 1px var(--paper), 0 0 0 3px var(--accent-paper)" }
  }
  if (state === "shown") {
    return {
      ...base,
      background: "color-mix(in srgb, var(--mask) 25%, transparent)",
      boxShadow: "inset 0 0 0 1px var(--paper-line)",
    }
  }
  return { ...base, background: "var(--mask)", boxShadow: "inset 0 0 0 1px var(--mask-edge)" }
}

function polygonStyle(state: MaskState): CSSProperties {
  const base: CSSProperties = {
    vectorEffect: "non-scaling-stroke",
    transitionProperty: "fill, stroke",
    transitionDuration: fade(state),
  }
  if (state === "asked") return { ...base, fill: "var(--accent-paper-asked)", stroke: "var(--paper-ink)", strokeWidth: 2 }
  if (state === "answer") return { ...base, fill: "transparent", stroke: "var(--paper)", strokeWidth: 2 }
  if (state === "shown") {
    return { ...base, fill: "color-mix(in srgb, var(--mask) 25%, transparent)", stroke: "var(--paper-line)", strokeWidth: 1 }
  }
  return { ...base, fill: "var(--mask)", stroke: "var(--mask-edge)", strokeWidth: 1 }
}

/** The ring an answered polygon wears; a stroke wider than the paper line drawn over it. */
const ANSWER_RING: CSSProperties = {
  vectorEffect: "non-scaling-stroke",
  fill: "none",
  stroke: "var(--accent-paper)",
  strokeWidth: 6,
}

/** Every mask of the card, positioned in percent of the image so it follows any zoom. */
export const OcclusionMasks = memo(function OcclusionMasks({ placed, frameHeight }: { placed: PlacedMask[]; frameHeight: number }) {
  const polygons = placed.filter((item) => item.mask.shape === "polygon" && item.mask.points)

  return (
    <>
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible" }}
      >
        {polygons.map(({ mask, state }) => (
          <g key={mask.id} data-mask={mask.id} data-state={state}>
            {state === "answer" && <polygon points={polygonPoints(mask.points!)} style={ANSWER_RING} />}
            <polygon points={polygonPoints(mask.points!)} style={polygonStyle(state)} />
          </g>
        ))}
      </svg>
      {placed.map(({ mask, state }) => {
        const heightPx = mask.h * frameHeight
        const position: CSSProperties = {
          left: `${mask.x * 100}%`,
          top: `${mask.y * 100}%`,
          width: `${mask.w * 100}%`,
          height: `${mask.h * 100}%`,
        }

        if (mask.shape === "polygon") {
          // The outline is the SVG above; only the asked mask needs a box of its own, for the "?".
          if (state !== "asked") return null
          return (
            <span
              key={mask.id}
              style={{ ...boxStyle("asked", false, heightPx), ...position, background: "transparent", boxShadow: "none" }}
            >
              ?
            </span>
          )
        }

        return (
          <span
            key={mask.id}
            data-mask={mask.id}
            data-state={state}
            style={{ ...boxStyle(state, mask.shape === "ellipse", heightPx), ...position }}
          >
            {state === "asked" ? "?" : null}
          </span>
        )
      })}
    </>
  )
})
