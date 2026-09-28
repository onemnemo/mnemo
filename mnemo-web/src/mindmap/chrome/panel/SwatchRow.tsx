import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { BRANCH_COUNT, branchColor, branchToken } from "../../scene/tokens"

export interface SwatchRowProps {
  /** Names the hues, as "{label} 3". */
  label: string
  /** What Auto is called here, and the colour it would hand back. */
  auto: { label: string; color: string }
  /** Whether nothing of its own is set, which is what lights Auto. */
  inherited: boolean
  /** Whether hue `index` is the one set, asked only when something is. */
  picked: (index: number) => boolean
  /** A branch token, or null for Auto. */
  onPick: (token: string | null) => void
}

/** Auto, then the eight branch hues, in one row. */
export function SwatchRow({ label, auto, inherited, picked, onPick }: SwatchRowProps) {
  return (
    <div className="grid grid-cols-9 gap-px">
      <Swatch label={auto.label} on={inherited} color={auto.color} hollow onPick={() => onPick(null)} />
      {Array.from({ length: BRANCH_COUNT }, (_, index) => (
        <Swatch
          key={index}
          label={`${label} ${index + 1}`}
          on={!inherited && picked(index)}
          color={branchColor(index)}
          onPick={() => onPick(branchToken(index))}
        />
      ))}
    </div>
  )
}

function Swatch({
  label,
  on,
  color,
  hollow,
  onPick,
}: {
  label: string
  on: boolean
  color: string
  /** Auto: a ring with a dot, rather than a filled disc. */
  hollow?: boolean
  onPick: () => void
}) {
  const ring = on ? `0 0 0 2px var(--surface-float), 0 0 0 3.5px ${color}` : null
  const rest = hollow ? "0 0 0 0 transparent" : "inset 0 0 0 1px var(--line-soft)"
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={on}
        onClick={onPick}
        className="grid h-8 place-items-center rounded-[9px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          aria-hidden
          className={cn(
            "grid size-[18px] place-items-center rounded-full",
            "transition-shadow duration-(--duration-press) ease-[ease]",
          )}
          style={
            hollow
              ? { boxShadow: `${ring ?? rest}, inset 0 0 0 2px ${color}` }
              : { background: color, boxShadow: ring ?? rest }
          }
        >
          {hollow ? <span className="size-1.5 rounded-full" style={{ background: color }} /> : null}
        </span>
      </button>
    </Tooltip>
  )
}
