import { cn } from "@/lib/utils"

/**
 * The learning-steps box. Unlike the other settings fields this one reports on every keystroke
 * rather than on blur, because the red border is the only thing telling the reader why Save
 * went away - waiting for blur would show it after the fact.
 */
export function StepsField({
  value,
  invalid,
  onChange,
  label,
}: {
  value: string
  invalid: boolean
  onChange: (next: string) => void
  /** Accessible name, since the visible label lives in the row shell. */
  label: string
}) {
  return (
    <input
      value={value}
      aria-label={label}
      aria-invalid={invalid}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-[30px] w-[120px] rounded-sm border bg-[var(--text-control-background)] px-2.5",
        "text-center font-mono text-body-small text-text-primary outline-none",
        // The invalid border has to win while focused too, or the error disappears the moment
        // the reader goes back to fix it.
        invalid
          ? "border-[var(--destructive-button-color)]"
          : "border-input focus:border-[var(--text-control-border-focused)]",
      )}
    />
  )
}
