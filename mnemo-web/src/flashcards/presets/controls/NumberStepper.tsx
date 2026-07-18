import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * A split `[- value +]` counter, matching the desktop's stepper rather than a spin box: the
 * value is typeable, and the two buttons sit on either side of it instead of stacking.
 */
export function NumberStepper({
  value,
  min = 0,
  max,
  onChange,
  label,
}: {
  value: number
  min?: number
  max: number
  onChange: (next: number) => void
  /** Accessible name, since the visible label lives in the row shell. */
  label: string
}) {
  const [draft, setDraft] = useState(String(value))

  // Follow the value when it changes elsewhere - a preset switch, or "Restore defaults".
  useEffect(() => setDraft(String(value)), [value])

  const clamp = (next: number) => Math.min(max, Math.max(min, next))

  const step = (delta: number) => onChange(clamp(value + delta))

  /** Anything unreadable snaps back to the last good value rather than committing a NaN. */
  const commit = () => {
    const parsed = Number(draft.trim())
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const next = clamp(Math.round(parsed))
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className="flex h-7 items-stretch overflow-hidden rounded-sm border border-input bg-[var(--text-control-background)]">
      <StepButton
        label={`${label} −`}
        disabled={value <= min}
        onClick={() => step(-1)}
        className="border-r border-divider-subtle"
      >
        <span className="block h-[1.5px] w-[9px] bg-text-faded" />
      </StepButton>

      <input
        value={draft}
        inputMode="numeric"
        aria-label={label}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") setDraft(String(value))
          if (event.key === "ArrowUp") {
            event.preventDefault()
            step(1)
          }
          if (event.key === "ArrowDown") {
            event.preventDefault()
            step(-1)
          }
        }}
        className="w-11 bg-transparent text-center font-mono text-[12.5px] text-text-primary outline-none"
      />

      <StepButton
        label={`${label} +`}
        disabled={value >= max}
        onClick={() => step(1)}
        className="border-l border-divider-subtle"
      >
        <span className="relative block h-[9px] w-[9px]">
          <span className="absolute left-0 top-[3.75px] h-[1.5px] w-[9px] bg-text-faded" />
          <span className="absolute left-[3.75px] top-0 h-[9px] w-[1.5px] bg-text-faded" />
        </span>
      </StepButton>
    </div>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid w-[26px] shrink-0 cursor-pointer place-items-center transition-colors duration-150",
        "hover:bg-[var(--navigation-button-background-hover)] active:bg-[var(--button-background-pressed)]",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  )
}
