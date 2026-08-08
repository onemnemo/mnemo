import { Slider } from "radix-ui"

import { cn } from "@/lib/utils"

/** Track and thumb, shared by both modes so the two sliders are one control visually. */
const RAIL =
  "relative flex h-4 w-full touch-none select-none items-center"
const TRACK = "relative h-[3px] w-full grow rounded-pill bg-divider-subtle"
const RANGE = "absolute h-full rounded-pill bg-brand"
const THUMB =
  "block h-3.5 w-3.5 rounded-full border-2 border-brand bg-white shadow-elevation-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"

interface StepProps {
  mode?: "steps"
  steps: string[]
  value: string
  onChange: (next: string) => void
  /** Accessible name, since the visible label lives in the row shell. */
  label: string
}

interface NumericProps {
  mode: "numeric"
  min: number
  max: number
  step: number
  value: number
  onChange: (next: number) => void
  /** Accessible name, since the visible label lives in the row shell. */
  label: string
}

/**
 * A slider over named steps, or over a numeric range with an integer readout.
 *
 * Steps mode persists the step's label, not an index, the desktop's step slider does the same,
 * which is why those values are language-bound. Numeric mode is what the widget config dialog uses:
 * it snaps to whole ticks and shows the current value beside the track rather than a row of labels,
 * because a range like 1..90 would print ninety of them.
 */
export function StepSliderControl(props: StepProps | NumericProps) {
  if (props.mode === "numeric") return <NumericSlider {...props} />
  return <StepSlider {...props} />
}

function NumericSlider({ min, max, step, value, onChange, label }: NumericProps) {
  return (
    <div className="flex items-center gap-2.5">
      <Slider.Root
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => {
          if (next !== undefined && next !== value) onChange(next)
        }}
        aria-label={label}
        className={cn(RAIL, "flex-1")}
      >
        <Slider.Track className={TRACK}>
          <Slider.Range className={RANGE} />
        </Slider.Track>
        <Slider.Thumb className={THUMB} />
      </Slider.Root>

      {/* An integer beside the track, as on the desktop: the slider is a double but the value it
          persists and shows is always whole. */}
      <span className="min-w-6 text-right font-mono text-body-small text-text-secondary tabular-nums">
        {Math.round(value)}
      </span>
    </div>
  )
}

function StepSlider({ steps, value, onChange, label }: StepProps) {
  // An unrecognized stored value (saved under a different language) lands on the
  // first step rather than leaving the slider blank.
  const index = Math.max(0, steps.indexOf(value))

  return (
    <div className="w-[220px]">
      <Slider.Root
        min={0}
        max={steps.length - 1}
        step={1}
        value={[index]}
        onValueChange={([next]) => {
          const step = steps[next ?? 0]
          if (step !== undefined && step !== value) onChange(step)
        }}
        aria-label={label}
        className={RAIL}
      >
        <Slider.Track className={TRACK}>
          <Slider.Range className={RANGE} />
        </Slider.Track>
        <Slider.Thumb className={THUMB} />
      </Slider.Root>

      <div className="mt-1 flex justify-between">
        {steps.map((step, i) => (
          <span
            key={step}
            className={cn(
              "text-micro",
              i === index ? "font-medium text-text-secondary" : "text-text-faded",
            )}
          >
            {step}
          </span>
        ))}
      </div>
    </div>
  )
}
