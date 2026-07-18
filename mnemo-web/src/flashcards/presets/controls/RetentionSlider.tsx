import { Slider } from "radix-ui"

import { MAX_RETENTION_PCT, MIN_RETENTION_PCT } from "../presets"

/**
 * Desired retention, in whole percent. The existing step slider works over named string steps,
 * which cannot express a range this wide, so this one is numeric - the track, range and thumb
 * are the same shapes so the two read as one control.
 */
export function RetentionSlider({
  percent,
  onChange,
  label,
}: {
  percent: number
  onChange: (next: number) => void
  /** Accessible name, since the visible label lives in the row shell. */
  label: string
}) {
  return (
    <div className="flex w-[220px] items-center gap-2.5">
      <Slider.Root
        min={MIN_RETENTION_PCT}
        max={MAX_RETENTION_PCT}
        step={1}
        value={[percent]}
        onValueChange={([next]) => {
          if (next !== undefined && next !== percent) onChange(next)
        }}
        aria-label={label}
        aria-valuetext={`${percent}%`}
        className="relative flex h-4 w-[150px] shrink-0 touch-none select-none items-center"
      >
        <Slider.Track className="relative h-[3px] w-full grow rounded-pill bg-divider-subtle">
          <Slider.Range className="absolute h-full rounded-pill bg-brand" />
        </Slider.Track>
        <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-brand bg-white shadow-elevation-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </Slider.Root>

      <span className="w-9 text-center font-mono text-body-small text-text-secondary">{percent}%</span>
    </div>
  )
}
