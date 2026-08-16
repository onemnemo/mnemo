import { getIconMarkup, getLucideIcon, type IconName } from "@/components/icon/icon-registry"
import { cn } from "@/lib/utils"

/**
 * Icons are deliberately thinner than their default and a step lighter than the label
 * they sit beside. At full weight they compete with the words instead of supporting
 * them, which is what makes a dense interface feel heavy.
 */
const DEFAULT_STROKE = 1.5

export interface AppIconProps {
  /** A lucide name ("house"), or a project icon ("sidebar/overview"). */
  name: IconName
  /** Square size in px. Overridden by width/height. */
  size?: number
  width?: number
  height?: number
  className?: string
  /** Line weight. Lucide glyphs only; project SVGs carry their own. */
  strokeWidth?: number
  /** Keep the source SVG's own colors (the multi-color badges) instead of tinting. */
  preserveColors?: boolean
  /** Accessible label; when omitted the icon is aria-hidden (decorative). */
  title?: string
}

/**
 * The only way icons enter the UI.
 *
 * Both sources render to the same box and inherit `color`, so a caller never has to know
 * whether a name resolved to a lucide glyph or to hand-drawn art, and swapping one for
 * the other is a change to the registry alone.
 */
export function AppIcon({
  name,
  size = 16,
  width,
  height,
  className,
  strokeWidth = DEFAULT_STROKE,
  preserveColors,
  title,
}: AppIconProps) {
  const shared = {
    role: title ? ("img" as const) : undefined,
    "aria-label": title,
    "aria-hidden": title ? undefined : true,
  }

  // Project art first, so a bare name can be claimed by a custom file.
  const markup = getIconMarkup(name, preserveColors)
  if (markup != null) {
    return (
      <span
        {...shared}
        className={cn("inline-flex shrink-0 [&>svg]:block [&>svg]:size-full", className)}
        style={{ width: width ?? size, height: height ?? size }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    )
  }

  const Lucide = getLucideIcon(name)
  if (Lucide != null) {
    return (
      <Lucide
        {...shared}
        className={cn("inline-block shrink-0", className)}
        width={width ?? size}
        height={height ?? size}
        strokeWidth={strokeWidth}
      />
    )
  }

  if (import.meta.env.DEV) console.error(`[AppIcon] unknown icon "${name}"`)
  return null
}
