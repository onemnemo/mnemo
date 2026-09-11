import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"

import { PROFILE_COLOURS, profileColour, profileInitials } from "./profile-colours"

export function ProfileMark({
  name,
  colour,
  pictureUrl,
  size = 18,
  className,
}: {
  name: string
  colour: string
  pictureUrl?: string | null
  size?: number
  className?: string
}) {
  const selected = PROFILE_COLOURS.find((option) => option.id === profileColour(colour))!
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.4),
    background: selected.background,
    color: selected.foreground,
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold",
        className,
      )}
      style={style}
    >
      {pictureUrl ? (
        <img src={pictureUrl} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        profileInitials(name)
      )}
    </span>
  )
}
