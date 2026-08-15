import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"

// The logo art is 60x50, so the glyph keeps that ratio inside the circle.
const GLYPH_WIDTH_RATIO = 0.6
const GLYPH_HEIGHT_RATIO = 0.5

/**
 * Soma's brand mark: the Mnemo glyph on a filled accent disc.
 *
 * The one place in Soma the accent is used as a fill rather than as an emphasis. Every
 * other surface keeps it for meaning, but this is a brand mark, so it is the exception
 * rather than a colour choice that spreads.
 */
export function SomaMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg", className)}
      style={{ width: size, height: size }}
    >
      <AppIcon
        name="branding/logo-icon"
        width={Math.round(size * GLYPH_WIDTH_RATIO)}
        height={Math.round(size * GLYPH_HEIGHT_RATIO)}
      />
    </span>
  )
}
