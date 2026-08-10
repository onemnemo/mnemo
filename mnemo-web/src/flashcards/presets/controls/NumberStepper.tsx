import { useEffect, useState } from "react"
import type { ReactNode } from "react"

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
    <div className="flex h-8 items-center rounded-lg p-0.5 shadow-[0_0_0_1px_var(--line)]">
      <StepButton label={`${label} -`} disabled={value <= min} onClick={() => step(-1)}>
        <span className="block h-[1.5px] w-[9px] rounded-full bg-current" />
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
        className="w-11 bg-transparent text-center text-[13px] font-medium tabular-nums text-ink outline-none"
      />

      <StepButton label={`${label} +`} disabled={value >= max} onClick={() => step(1)}>
        <span className="relative block size-[9px]">
          <span className="absolute top-[3.75px] left-0 h-[1.5px] w-[9px] rounded-full bg-current" />
          <span className="absolute top-0 left-[3.75px] h-[9px] w-[1.5px] rounded-full bg-current" />
        </span>
      </StepButton>
    </div>
  )
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-ink-2 transition-colors",
        "hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35",
      )}
    >
      {children}
    </button>
  )
}
