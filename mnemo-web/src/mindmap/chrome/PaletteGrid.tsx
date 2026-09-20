import { BRANCH_COUNT, branchColor, branchToken } from "../scene/tokens"
import { SwatchGlyph } from "./glyphs"
import { Cell, Group } from "./menu"

export interface PaletteGridProps {
  label: string
  active: (index: number) => boolean
  onPick: (token: string, index: number) => void
}

export function PaletteGrid({ label, active, onPick }: PaletteGridProps) {
  return (
    <Group label={label}>
      <div className="grid w-full grid-cols-4 gap-1">
        {Array.from({ length: BRANCH_COUNT }, (_, index) => (
          <Cell
            key={index}
            label={`${label} ${index + 1}`}
            active={active(index)}
            onClick={() => onPick(branchToken(index), index)}
          >
            <SwatchGlyph color={branchColor(index)} active={active(index)} />
          </Cell>
        ))}
      </div>
    </Group>
  )
}
