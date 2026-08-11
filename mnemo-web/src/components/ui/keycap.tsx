import { cn } from "@/lib/utils"

import { formatChordParts } from "@/keybinds/chord"

/**
 * A shortcut drawn as the keys you press.
 *
 * One cap per key rather than one pill for the whole chord. A shortcut is a physical
 * instruction and reads as a sequence: three small boxes say "hold these, then press
 * that" in a way "Ctrl Shift H" set in a single border does not.
 */
export function Keycap({
  chord,
  muted,
  className,
}: {
  /** A canonical chord ("Primary+Shift+H"), or null when the action has none. */
  chord: string | null
  /** Unbound or inactive: the caps lose their fill and keep only a hairline. */
  muted?: boolean
  className?: string
}) {
  if (!chord) {
    return <span className="text-[12.5px] text-ink-3">—</span>
  }

  return (
    <span className={cn("flex items-center gap-1", className)}>
      {formatChordParts(chord).map((part, i) => (
        <kbd
          key={`${part}:${i}`}
          className={cn(
            "flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] px-1.5",
            "font-sans text-[11.5px] font-medium",
            muted
              ? "text-ink-3 shadow-[0_0_0_1px_var(--line-soft)]"
              : "bg-canvas text-ink-2 shadow-[0_0_0_1px_var(--line)]",
          )}
        >
          {part}
        </kbd>
      ))}
    </span>
  )
}
