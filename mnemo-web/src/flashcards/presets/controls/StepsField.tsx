import { cn } from "@/lib/utils"

/**
 * The learning-steps box. Unlike the other settings fields this one reports on every keystroke
 * rather than on blur, because the accent border going red is the only thing telling the reader
 * why Save went away - waiting for blur would show it after the fact.
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
        "h-8 w-[140px] rounded-lg bg-transparent px-2.5 text-center text-[13px] tabular-nums text-ink outline-none",
        // The invalid ring has to win while focused too, or the error disappears the moment the
        // reader goes back to fix it.
        invalid
          ? "shadow-[0_0_0_1.5px_var(--danger)]"
          : "shadow-[0_0_0_1px_var(--line)] focus:shadow-[0_0_0_1.5px_var(--solid)]",
      )}
    />
  )
}
