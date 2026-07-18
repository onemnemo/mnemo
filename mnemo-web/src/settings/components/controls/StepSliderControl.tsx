import { Slider } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A slider over named steps. It persists the step's label, not an index — the
 * desktop's step slider does the same, which is why these values are language-bound.
 */
export function StepSliderControl({
  steps,
  value,
  onChange,
  label,
}: {
  steps: string[]
  value: string
  onChange: (next: string) => void
  /** Accessible name, since the visible label lives in the row shell. */
  label: string
}) {
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
        className="relative flex h-4 w-full touch-none select-none items-center"
      >
        <Slider.Track className="relative h-[3px] w-full grow rounded-pill bg-divider-subtle">
          <Slider.Range className="absolute h-full rounded-pill bg-brand" />
        </Slider.Track>
        <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-brand bg-white shadow-elevation-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
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
