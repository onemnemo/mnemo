import { StepSliderControl } from "@/settings/components/controls/StepSliderControl"

import { MAX_RETENTION_PCT, MIN_RETENTION_PCT } from "../presets"

/**
 * Desired retention, in whole percent.
 *
 * The shared control in its numeric mode rather than a slider of its own: a second
 * implementation of the same shapes drifts from this one the first time either is retuned.
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
      <div className="flex w-[150px] shrink-0 items-center">
        <StepSliderControl
          mode="numeric"
          min={MIN_RETENTION_PCT}
          max={MAX_RETENTION_PCT}
          step={1}
          value={percent}
          onChange={onChange}
          label={label}
        />
      </div>

      <span className="w-9 text-center text-[13px] font-medium tabular-nums text-ink">{percent}%</span>
    </div>
  )
}
