import { cn } from "@/lib/utils"

/**
 * The shared range control: a native `input[type=range]` under the `.slider` utility.
 *
 * Native rather than a composed track and thumb, because the browser already gives the
 * whole keyboard, the whole pointer gesture and the whole accessibility tree for free, and
 * a hand-built one only gets to lose parts of them. The fill is a gradient on the track
 * rather than a second element, so there is nothing to keep in sync with the value.
 */
function Rail({
  value,
  min,
  max,
  step,
  label,
  onChange,
  className,
}: {
  value: number
  min: number
  max: number
  step: number
  label: string
  onChange: (next: number) => void
  className?: string
}) {
  // A degenerate range would divide by zero and paint the track blank rather than full.
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 100

  return (
    <input
      type="range"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
      className={cn("slider h-1.5 w-full cursor-pointer appearance-none rounded-full", className)}
      style={{
        background: `linear-gradient(to right, var(--solid) ${percent}%, var(--canvas-sunken) ${percent}%)`,
      }}
    />
  )
}

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
 * A slider over named steps, or over a numeric range.
 *
 * Steps mode persists the step's label, not an index, because the desktop's step slider does
 * the same, which is why those values are language-bound. Numeric mode is what the widget
 * config dialog uses; it carries no readout of its own, since the dialog prints the value
 * beside the field's label where a settings row has no room to.
 */
export function StepSliderControl(props: StepProps | NumericProps) {
  if (props.mode === "numeric") {
    const { min, max, step, value, onChange, label } = props
    return <Rail value={value} min={min} max={max} step={step} label={label} onChange={onChange} />
  }
  return <StepSlider {...props} />
}

function StepSlider({ steps, value, onChange, label }: StepProps) {
  // An unrecognized stored value (saved under a different language) lands on the
  // first step rather than leaving the slider blank.
  const index = Math.max(0, steps.indexOf(value))

  return (
    <div className="w-[220px]">
      <Rail
        value={index}
        min={0}
        max={Math.max(0, steps.length - 1)}
        step={1}
        label={label}
        onChange={(next) => {
          const picked = steps[next]
          if (picked !== undefined && picked !== value) onChange(picked)
        }}
      />

      <div className="mt-2 flex justify-between">
        {steps.map((stepLabel, i) => (
          <span
            key={stepLabel}
            className={cn("text-micro", i === index ? "font-medium text-ink-2" : "text-ink-3")}
          >
            {stepLabel}
          </span>
        ))}
      </div>
    </div>
  )
}
