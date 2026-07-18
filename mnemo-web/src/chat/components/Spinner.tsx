import { cn } from "@/lib/utils"

/** A small indeterminate ring, used for running trace steps and the working glyph. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent",
        className,
      )}
      aria-hidden
    />
  )
}
