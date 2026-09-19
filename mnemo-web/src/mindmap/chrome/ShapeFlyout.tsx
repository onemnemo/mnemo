import { useEffect } from "react"

import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { ShapeType } from "../model/document"
import { FlyoutPanel } from "./FlyoutPanel"
import { ShapeGlyph } from "./glyphs"

interface ShapeEntry {
  readonly shape: ShapeType
  readonly label: string
  readonly mnemonic: string
}

const SHAPES: readonly ShapeEntry[] = [
  { shape: "rectangle", label: "ShapeRectangle", mnemonic: "R" },
  { shape: "ellipse", label: "ShapeEllipse", mnemonic: "O" },
  { shape: "diamond", label: "ShapeDiamond", mnemonic: "D" },
  { shape: "hexagon", label: "ShapeHexagon", mnemonic: "H" },
  { shape: "parallelogram", label: "ShapeParallelogram", mnemonic: "P" },
  { shape: "line", label: "ShapeLine", mnemonic: "L" },
  { shape: "arrow", label: "ShapeArrow", mnemonic: "A" },
  { shape: "blob", label: "ShapeBlob", mnemonic: "B" },
]

const GLYPH_WIDTH = 28
const GLYPH_HEIGHT = 18

export interface ShapeFlyoutProps {
  shape: ShapeType
  onShape: (shape: ShapeType) => void
  onClose: () => void
}

export function ShapeFlyout({ shape, onShape, onClose }: ShapeFlyoutProps) {
  const t = useT()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return
      const letter = event.key.toUpperCase()
      const hit = SHAPES.find((entry) => entry.mnemonic === letter)
      if (!hit) return
      // Stop H from also arming the canvas pan tool.
      event.preventDefault()
      event.stopPropagation()
      onShape(hit.shape)
      onClose()
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [onShape, onClose])

  return (
    <FlyoutPanel onClose={onClose} className="w-max p-2">
      <div className="grid grid-cols-4 gap-1">
        {SHAPES.map((entry) => {
          const active = entry.shape === shape
          const label = t("Mindmap", entry.label)
          return (
            <button
              key={entry.shape}
              type="button"
              aria-label={label}
              aria-pressed={active}
              aria-keyshortcuts={entry.mnemonic}
              onClick={() => {
                onShape(entry.shape)
                onClose()
              }}
              className={cn(
                "relative flex h-[58px] min-w-[66px] cursor-pointer flex-col items-center justify-end gap-2 rounded-lg px-1 pb-2 outline-none transition-colors duration-120",
                active
                  ? "bg-accent-wash text-accent-ink"
                  : "text-ink-2 hover:bg-frame-hover hover:text-ink focus-visible:bg-frame-hover focus-visible:text-ink",
              )}
            >
              <kbd
                aria-hidden
                className={cn(
                  "absolute top-1.5 right-2 font-sans text-[9px] leading-none font-medium",
                  active ? "opacity-70" : "text-ink-3",
                )}
              >
                {entry.mnemonic}
              </kbd>
              <ShapeGlyph shape={entry.shape} width={GLYPH_WIDTH} height={GLYPH_HEIGHT} filled={active} />
              <span className="text-[10px] leading-none whitespace-nowrap">{label}</span>
            </button>
          )
        })}
      </div>
    </FlyoutPanel>
  )
}
