import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { shapePath } from "../canvas/shape-path"
import type { ShapeType } from "../model/document"
import { FlyoutPanel } from "./FlyoutPanel"

/** The primitives, in a fixed order: two rows of four. */
const SHAPES: readonly { shape: ShapeType; key: string }[] = [
  { shape: "rectangle", key: "ShapeRectangle" },
  { shape: "ellipse", key: "ShapeEllipse" },
  { shape: "diamond", key: "ShapeDiamond" },
  { shape: "hexagon", key: "ShapeHexagon" },
  { shape: "parallelogram", key: "ShapeParallelogram" },
  { shape: "line", key: "ShapeLine" },
  { shape: "arrow", key: "ShapeArrow" },
  { shape: "blob", key: "ShapeBlob" },
]

/** The glyph box each primitive is previewed in. Wider than tall, like the shapes it plants. */
const GLYPH_WIDTH = 30
const GLYPH_HEIGHT = 20

/**
 * The box the outline is actually built in, before being scaled down into the glyph.
 *
 * A rectangle's corner radius is the one absolute number in the geometry, so a shape drawn straight
 * into a 26 pixel box came out with rounding half its own height: the rectangle previewed as a
 * stadium and read as the same tile as the ellipse and the blob. Building at something near the size
 * of a real element and scaling the result gives every primitive the proportions it will have on the
 * canvas, which is the only thing that makes a picker of eight rounded outlines legible.
 */
const BUILD_SCALE = 4
const PAD = 1

export interface ShapeFlyoutProps {
  shape: ShapeType
  onShape: (shape: ShapeType) => void
  onClose: () => void
}

/**
 * What the shape tool plants.
 *
 * Each primitive is previewed with the same function that draws it on the canvas, so the picker and
 * the map cannot disagree about what a hexagon is.
 *
 * A pick closes the panel, unlike the connect tool's, which holds four values and is not finished
 * after one press. There is one question here, and the answer to it is followed by putting the shape
 * somewhere, which is behind wherever the panel is.
 */
export function ShapeFlyout({ shape, onShape, onClose }: ShapeFlyoutProps) {
  const t = useT()

  return (
    <FlyoutPanel onClose={onClose} className="w-[260px]">
      <div className="grid grid-cols-4 gap-1">
        {SHAPES.map((entry) => {
          const active = entry.shape === shape
          const label = t("Mindmap", entry.key)
          return (
            <button
              key={entry.shape}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={active}
              onClick={() => {
                onShape(entry.shape)
                onClose()
              }}
              // The group is the whole tile, so hovering the label lifts the preview's frame with it,
              // and the two never disagree about whether the pointer is on this shape.
              className="group flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-1 outline-none"
            >
              {/* The preview sits in a framed chip rather than floating on the panel, so the eight
                  outlines read as a set of samples and the picked one is a filled tile, not a shape
                  that happens to be a shade darker. */}
              <span
                className={cn(
                  "grid h-[38px] w-full place-items-center rounded-lg border transition-colors duration-120",
                  active
                    ? "border-accent bg-accent-wash text-accent-ink"
                    : "border-line bg-canvas-sunken text-ink-2 group-hover:border-ink-3 group-hover:text-ink",
                )}
              >
                <svg
                  width={GLYPH_WIDTH}
                  height={GLYPH_HEIGHT}
                  viewBox={`0 0 ${GLYPH_WIDTH * BUILD_SCALE} ${GLYPH_HEIGHT * BUILD_SCALE}`}
                  aria-hidden
                >
                  <path
                    d={shapePath(
                      entry.shape,
                      (GLYPH_WIDTH - PAD * 2) * BUILD_SCALE,
                      (GLYPH_HEIGHT - PAD * 2) * BUILD_SCALE,
                    )}
                    transform={`translate(${PAD * BUILD_SCALE}, ${PAD * BUILD_SCALE})`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </span>
              <span
                className={cn(
                  "text-[10.5px] leading-none transition-colors duration-120",
                  active ? "text-accent-ink" : "text-ink-3 group-hover:text-ink",
                )}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-1.5 border-t border-line px-1.5 pt-2 pb-0.5 text-[10.5px] leading-snug text-ink-3">
        {t("Mindmap", "ShapesInlineTextHint")}
      </p>
    </FlyoutPanel>
  )
}
