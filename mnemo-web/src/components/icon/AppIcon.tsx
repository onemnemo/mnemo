import { getIconMarkup, type IconName } from "@/components/icon/icon-registry"
import { cn } from "@/lib/utils"

export interface AppIconProps {
  name: IconName
  /** Square size in px (default 16 = IconSize.Sm). Overridden by width/height. */
  size?: number
  width?: number
  height?: number
  className?: string
  /** Keep the source SVG's own colors (e.g. the XP / streak badges) instead of tinting. */
  preserveColors?: boolean
  /** Accessible label; when omitted the icon is aria-hidden (decorative). */
  title?: string
}

/**
 * Renders a Mnemo icon inline so it inherits `color` (currentColor). Ported
 * icons are monochrome and tint to the surrounding text color; pass
 * `preserveColors` for the few multi-color badges.
 */
export function AppIcon({ name, size = 16, width, height, className, preserveColors, title }: AppIconProps) {
  const markup = getIconMarkup(name, preserveColors)
  if (markup == null) return null

  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("inline-flex shrink-0 [&>svg]:block [&>svg]:size-full", className)}
      style={{ width: width ?? size, height: height ?? size }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
