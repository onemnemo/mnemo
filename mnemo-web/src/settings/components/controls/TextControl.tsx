import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * A single-line field that commits on blur or Enter rather than on every keystroke,
 * so typing a display name is one write instead of one per character.
 */
export function TextControl({
  value,
  onCommit,
  label,
  placeholder,
  secret,
  className,
}: {
  value: string
  onCommit: (next: string) => void
  /** Accessible name, since the visible label lives in the row shell. */
  label: string
  placeholder?: string
  secret?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState(value)

  // Follow the stored value when it changes elsewhere (a reset, another surface).
  useEffect(() => setDraft(value), [value])

  function commit() {
    if (draft !== value) onCommit(draft)
  }

  return (
    <input
      type={secret ? "password" : "text"}
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete={secret ? "off" : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") setDraft(value)
      }}
      className={cn(
        "h-8 w-[220px] max-w-full rounded-lg bg-canvas-sunken px-2.5",
        "text-[13px] text-ink outline-none placeholder:text-ink-3",
        "focus:shadow-[0_0_0_1px_var(--line)]",
        className,
      )}
    />
  )
}
