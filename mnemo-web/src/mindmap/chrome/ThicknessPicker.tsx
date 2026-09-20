import { useT } from "@/i18n/useT"

import { DEFAULT_THICKNESS } from "../scene/line-geometry"
import { THICKNESSES } from "./choices"
import { ThicknessGlyph } from "./glyphs"
import { Cell, Group } from "./menu"

export interface ThicknessPickerProps {
  value: number | null | undefined
  onPick: (value: number) => void
}

export function ThicknessPicker({ value, onPick }: ThicknessPickerProps) {
  const t = useT()
  const active = value ?? DEFAULT_THICKNESS
  return (
    <Group label={t("Mindmap", "EdgeThickness")}>
      {THICKNESSES.map((entry) => (
        <Cell
          key={entry.value}
          label={t("Mindmap", entry.key)}
          active={active === entry.value}
          onClick={() => onPick(entry.value)}
        >
          <ThicknessGlyph thickness={entry.value} />
        </Cell>
      ))}
    </Group>
  )
}
