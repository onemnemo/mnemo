import type { CSSProperties } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { branchColor } from "../scene/tokens"
import { LayoutGlyph, NodeShapeGlyph, ShapeGlyph } from "./glyphs"
import {
  annulusPath,
  polar,
  RING_INNER,
  RING_OUTER,
  sectorAngle,
  SUB_INNER,
  SUB_OUTER,
  subAngle,
  subStep,
  WEDGE_GAP,
  WEDGE_ROUND,
  wedgePath,
  type RingHit,
} from "./radial"
import type { RingGlyph, RingSector } from "./sectors"

/** Half the box the ring is drawn in: the sub-ring's outer edge plus room for its stroke. */
export const RING_BOX = SUB_OUTER + 6

const LABEL_RADIUS = (RING_INNER + RING_OUTER) / 2 + 2
const CHEVRON_RADIUS = RING_OUTER - 9
const SUB_RADIUS = (SUB_INNER + SUB_OUTER) / 2

const PETAL = "fill var(--duration-petal) ease, stroke var(--duration-petal) ease"
const INK = "color var(--duration-petal) ease"

const paint = (token: string): CSSProperties => ({ fill: `var(${token})`, stroke: `var(${token})`, transition: PETAL })

/** A sub-ring layer's entrance: a quick fade, and a settle outward from the ring's centre, each item a beat after the last. */
function subring(shown: boolean, item: number): CSSProperties {
  const delay = shown ? `calc(var(--stagger-subring) * ${item})` : "0ms"
  return {
    opacity: shown ? 1 : 0,
    transform: shown ? "scale(1)" : "scale(0.9)",
    transition: `opacity var(--duration-subring-fade) ease ${delay}, transform var(--duration-subring) var(--ease-settle) ${delay}`,
  }
}

interface PetalsProps {
  sectors: readonly RingSector[]
  inert: ReadonlySet<string>
  hit: RingHit
}

/**
 * The ring itself: a backplate in the hairline colour, the wedges over it, and each sector's
 * sub-ring, in one box centred on the ring. Every sub-ring stays mounted and only the hot one is
 * shown, so opening one is a transition.
 */
export function RadialPetals({ sectors, inert, hit }: PetalsProps) {
  const count = sectors.length
  const step = 360 / count
  const box = RING_BOX * 2
  const viewBox = `${-RING_BOX} ${-RING_BOX} ${box} ${box}`
  const layer = "absolute inset-0 overflow-visible"

  return (
    <div className="absolute" style={{ left: -RING_BOX, top: -RING_BOX, width: box, height: box }}>
      <div className="absolute inset-0" style={{ filter: "var(--ring-shadow)" }}>
        <svg className={layer} viewBox={viewBox} aria-hidden>
          <path d={annulusPath(RING_INNER, RING_OUTER)} fillRule="evenodd" style={{ fill: "var(--line)" }} />
        </svg>

        {sectors.map((sector, index) => {
          const items = sector.sub?.length ?? 0
          if (items === 0) {
            return null
          }
          const angle = sectorAngle(index, count)
          const half = (items * subStep(items)) / 2
          return (
            <svg key={`band-${sector.id}`} className={layer} viewBox={viewBox} aria-hidden style={subring(hit.hot === index && !inert.has(sector.id), 0)}>
              <path
                d={wedgePath(angle - half, angle + half, SUB_INNER, SUB_OUTER, -WEDGE_GAP)}
                strokeWidth={WEDGE_ROUND * 2}
                strokeLinejoin="round"
                style={{ fill: "var(--line)", stroke: "var(--line)" }}
              />
            </svg>
          )
        })}

        <svg className={layer} viewBox={viewBox} aria-hidden>
          {sectors.map((sector, index) => {
            const angle = sectorAngle(index, count)
            return (
              <path
                key={sector.id}
                d={wedgePath(angle - step / 2, angle + step / 2, RING_INNER, RING_OUTER)}
                strokeWidth={WEDGE_ROUND * 2}
                strokeLinejoin="round"
                style={paint(sectorFill(inert.has(sector.id), hit, index))}
              />
            )
          })}
        </svg>

        {sectors.flatMap((sector, index) =>
          (sector.sub ?? []).map((item, j, all) => {
            const angle = subAngle(index, count, j, all.length)
            const half = subStep(all.length) / 2
            const on = hit.hot === index && hit.sub === j && !inert.has(item.id)
            return (
              <svg
                key={`sub-${sector.id}-${item.id}`}
                className={layer}
                viewBox={viewBox}
                aria-hidden
                style={subring(hit.hot === index && !inert.has(sector.id), j)}
              >
                <path
                  d={wedgePath(angle - half, angle + half, SUB_INNER, SUB_OUTER)}
                  strokeWidth={WEDGE_ROUND * 2}
                  strokeLinejoin="round"
                  style={paint(on ? "--solid" : "--surface-float")}
                />
              </svg>
            )
          }),
        )}
      </div>

      {sectors.map((sector, index) => (
        <SectorFace
          key={sector.id}
          sector={sector}
          angle={sectorAngle(index, count)}
          state={faceState(sector, inert, hit, index)}
        />
      ))}

      {sectors.flatMap((sector, index) =>
        (sector.sub ?? []).map((item, j, all) => {
          const at = polar(subAngle(index, count, j, all.length), SUB_RADIUS)
          const on = hit.hot === index && hit.sub === j && !inert.has(item.id)
          return (
            <div
              key={`face-${sector.id}-${item.id}`}
              className={cn(
                "absolute grid size-6 -translate-1/2 place-items-center",
                on ? "text-solid-fg" : inert.has(item.id) ? "text-ink-3 opacity-50" : "text-ink-2",
              )}
              style={{ left: RING_BOX + at.x, top: RING_BOX + at.y, ...subring(hit.hot === index && !inert.has(sector.id), j) }}
            >
              <GlyphView glyph={item.glyph} hot={on} />
            </div>
          )
        }),
      )}
    </div>
  )
}

type FaceState = "rest" | "hot" | "parent" | "inert"

function faceState(sector: RingSector, inert: ReadonlySet<string>, hit: RingHit, index: number): FaceState {
  if (inert.has(sector.id)) {
    return "inert"
  }
  if (hit.hot !== index) {
    return "rest"
  }
  return hit.sub === null ? "hot" : "parent"
}

function sectorFill(off: boolean, hit: RingHit, index: number): string {
  if (off || hit.hot !== index) {
    return "--surface-float"
  }
  return hit.sub !== null ? "--ring-parent" : "--ring-hot"
}

function SectorFace({ sector, angle, state }: { sector: RingSector; angle: number; state: FaceState }) {
  const t = useT()
  const at = polar(angle, LABEL_RADIUS)
  const chevron = polar(angle, CHEVRON_RADIUS)
  const lit = state === "hot" || state === "parent"
  const icon = lit ? "text-ink" : "text-ink-2"
  const label = lit ? "text-ink" : "text-ink-3"

  return (
    <>
      <div
        className={cn(
          "absolute flex -translate-1/2 flex-col items-center gap-[5px]",
          state === "inert" && "text-ink-3 opacity-50",
        )}
        style={{ left: RING_BOX + at.x, top: RING_BOX + at.y }}
      >
        <span className={cn("flex", state !== "inert" && icon)} style={{ transition: INK }}>
          <GlyphView glyph={sector.glyph} hot={lit} />
        </span>
        <span
          className={cn("text-[10.5px] leading-none font-medium whitespace-nowrap", state !== "inert" && label)}
          style={{ transition: INK }}
        >
          {t("Mindmap", sector.labelKey)}
        </span>
      </div>
      {sector.sub?.length ? (
        <span
          className={cn(
            "absolute flex size-2.5 -translate-1/2 opacity-55",
            state === "inert" ? "text-ink-3 opacity-50" : icon,
          )}
          style={{ left: RING_BOX + chevron.x, top: RING_BOX + chevron.y, rotate: `${angle}deg` }}
        >
          <AppIcon name="chevron-up" size={10} strokeWidth={3} />
        </span>
      ) : null}
    </>
  )
}

/** One sector's or sub item's picture, in the colour its wedge sets. */
function GlyphView({ glyph, hot }: { glyph: RingGlyph; hot: boolean }) {
  switch (glyph.kind) {
    case "icon":
      return <AppIcon name={glyph.name} size={19} strokeWidth={1.7} />
    case "shape":
      return <ShapeGlyph shape={glyph.shape} width={19} height={19} filled={hot} />
    case "node":
      return <NodeShapeGlyph shape={glyph.shape} />
    case "layout":
      return <LayoutGlyph algorithm={glyph.algorithm} />
    case "swatch":
      return (
        <span
          className="block size-4 rounded-full"
          style={{
            background: branchColor(glyph.index),
            boxShadow: hot
              ? "0 0 0 2px var(--solid), 0 0 0 3.5px var(--solid-fg)"
              : "0 0 0 1px color-mix(in srgb, var(--ink) 8%, transparent)",
          }}
        />
      )
  }
}
