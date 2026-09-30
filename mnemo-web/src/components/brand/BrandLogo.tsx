import { useId } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import {
  BAND_EXTENT,
  bandStops,
  brandMark,
  ICON_PATHS,
  LOCKUP_LETTER_PATHS,
  LOCKUP_MARK_PATHS,
  type LogoId,
} from "@/lib/brand/marks"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores/theme"

import { useLogo } from "./useLogo"

/**
 * The Mnemo mark or the full lockup, in the logo the user picked. A banded logo is drawn
 * inline with the wordmark in ink; the accent logo is the single-colour art, tinted by
 * the accent.
 */
export function BrandLogo({
  variant,
  width,
  height,
  className,
  logo,
}: {
  variant: "icon" | "full"
  width: number
  height: number
  className?: string
  /** Draw this logo rather than the chosen one (the picker's own tiles). */
  logo?: LogoId
}) {
  const chosen = useLogo()
  const dark = useThemeStore((s) => s.theme === "dark")
  // useId output carries characters a url(#...) reference would need escaped.
  const gradient = `brand-${useId().replace(/[^\w-]/g, "")}`
  const mark = brandMark(logo ?? chosen)

  if (!mark) {
    return (
      <AppIcon
        name={variant === "icon" ? "branding/logo-icon" : "branding/logo-full"}
        width={width}
        height={height}
        className={cn("text-accent", className)}
      />
    )
  }

  const petals = variant === "icon" ? ICON_PATHS : LOCKUP_MARK_PATHS
  return (
    <svg
      aria-hidden
      viewBox={variant === "icon" ? "0 0 60 50" : "0 0 340 50"}
      width={width}
      height={height}
      className={cn("block shrink-0", className)}
    >
      <defs>
        <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={BAND_EXTENT} y2={BAND_EXTENT}>
          {bandStops(mark.colors, dark).map(({ offset, color }, i) => (
            <stop key={i} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      {petals.map((d) => (
        <path key={d} d={d} fill={`url(#${gradient})`} />
      ))}
      {variant === "full" &&
        LOCKUP_LETTER_PATHS.map(({ d, evenOdd }) => (
          <path key={d} d={d} fill="var(--ink)" fillRule={evenOdd ? "evenodd" : undefined} />
        ))}
    </svg>
  )
}
