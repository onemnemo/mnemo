import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { shapePath } from "../canvas/shape-path"
import type { ShapeType } from "../model/document"
import { FlyoutPanel } from "./FlyoutPanel"

/**
 * The primitives, in a fixed order.
 *
 * Seven rather than the eight in that image: blob is not in the model, and a control that plants a
 * shape the document cannot store is worse than one that does not offer it.
 */
const SHAPES: readonly { shape: ShapeType; key: string }[] = [
  { shape: "rectangle", key: "ShapeRectangle" },
  { shape: "ellipse", key: "ShapeEllipse" },
  { shape: "diamond", key: "ShapeDiamond" },
  { shape: "hexagon", key: "ShapeHexagon" },
  { shape: "parallelogram", key: "ShapeParallelogram" },
  { shape: "line", key: "ShapeLine" },
  { shape: "arrow", key: "ShapeArrow" },
]

/** The glyph box each primitive is previewed in. Wider than tall, like the shapes it plants. */
const GLYPH_WIDTH = 26
const GLYPH_HEIGHT = 18

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
 */
export function ShapeFlyout({ shape, onShape, onClose }: ShapeFlyoutProps) {
  const t = useT()

  return (
    <FlyoutPanel onClose={onClose} className="w-[268px]">
      <div className="grid grid-cols-4 gap-1">
        {SHAPES.map((entry) => {
          const active = entry.shape === shape
          return (
            <button
              key={entry.shape}
              type="button"
              aria-pressed={active}
              onClick={() => onShape(entry.shape)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg py-1.5 transition-colors duration-120",
                active ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
              )}
            >
              <svg width={GLYPH_WIDTH} height={GLYPH_HEIGHT} aria-hidden>
                <path
                  d={shapePath(entry.shape, GLYPH_WIDTH - 2, GLYPH_HEIGHT - 2)}
                  transform="translate(1, 1)"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-[10.5px] leading-none">{t("Mindmap", entry.key)}</span>
            </button>
          )
        })}
      </div>

      <p className="mt-1 px-1.5 pb-0.5 text-[10.5px] text-ink-3">
        {t("Mindmap", "ShapesInlineTextHint")}
      </p>
    </FlyoutPanel>
  )
}
