import { useState } from "react"

import { useT } from "@/i18n/useT"

import type { ArrowCap, ShapeContent } from "../model/document"
import type { SceneElement } from "../model/scene"
import { branchSlot } from "../scene/tokens"
import { FloatBar, Sep } from "./bits"
import type { ColorControl } from "./color-control"
import { EndsPicker } from "./EndsPicker"
import { EndsGlyph, SwatchGlyph, ThicknessGlyph } from "./glyphs"
import { Popped } from "./menu"
import { PaletteGrid } from "./PaletteGrid"
import { ThicknessPicker } from "./ThicknessPicker"

export interface LinePatch {
  startCap?: ArrowCap
  endCap?: ArrowCap
  thickness?: number
}

export interface LineBarProps {
  element: SceneElement
  count: number
  onStyle: (patch: LinePatch) => void
  color: ColorControl | null
}

export function LineBar({ element, count, onStyle, color }: LineBarProps) {
  const t = useT()
  const [open, setOpen] = useState<"ends" | "weight" | "color" | null>(null)
  const line = element.line!
  const content = element.content as ShapeContent
  const shown = (which: typeof open) => (on: boolean) => setOpen(on ? which : null)

  return (
    <FloatBar>
      <Popped
        label={t("Mindmap", "Ends")}
        face={<EndsGlyph start={line.startCap} end={line.endCap} />}
        open={open === "ends"}
        onOpen={shown("ends")}
        width="w-[196px]"
      >
        <EndsPicker
          start={line.startCap}
          end={line.endCap}
          onStart={(cap) => onStyle({ startCap: cap })}
          onEnd={(cap) => onStyle({ endCap: cap })}
        />
      </Popped>

      <Popped
        label={t("Mindmap", "EdgeThickness")}
        face={<ThicknessGlyph thickness={line.thickness} />}
        open={open === "weight"}
        onOpen={shown("weight")}
        width="w-[168px]"
      >
        <ThicknessPicker value={content.thickness} onPick={(thickness) => onStyle({ thickness })} />
      </Popped>

      {color ? (
        <Popped
          label={t("Mindmap", "Color")}
          face={<SwatchGlyph color={color.color ?? "var(--line)"} active={false} />}
          open={open === "color"}
          onOpen={shown("color")}
          width="w-[188px]"
        >
          <PaletteGrid
            label={t("Mindmap", "Color")}
            active={(index) => branchSlot(index) === color.slot}
            onPick={(token) => {
              color.onPick(token, false)
              setOpen(null)
            }}
          />
          <button
            type="button"
            onClick={() => {
              color.onPick(null, false)
              setOpen(null)
            }}
            className="block w-full rounded-lg px-2 py-1.5 text-left text-[11.5px] text-ink-2 hover:bg-frame-hover hover:text-ink"
          >
            {t("Mindmap", "DefaultColor")}
          </button>
        </Popped>
      ) : null}

      {count > 1 ? (
        <>
          <Sep />
          <span className="px-1 text-[11.5px] tabular-nums text-ink-3">{count}</span>
        </>
      ) : null}
    </FloatBar>
  )
}
