import { cn } from "@/lib/utils"

import type { ImageCrop } from "./geometry"

/**
 * A stored crop, drawn into a box of the crop's own shape.
 *
 * This is the payoff for keeping crops as fractions: it measures nothing. No ResizeObserver, no
 * naturalWidth, no waiting for a load event, and no layout jump when the bytes land, because the
 * box reserves its height from `aspect` before any have arrived.
 *
 * It works because the crop window always matches the frame's aspect, so scaling the source to
 * 100/w by 100/h percent of the box distorts by exactly nothing: the two stretches cancel. A
 * container of some other shape needs `fitCropToContainer` and a measurement instead.
 */
export function CroppedImage({
  src,
  crop,
  alt = "",
  className,
}: {
  src: string
  crop: ImageCrop
  alt?: string
  className?: string
}) {
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ aspectRatio: crop.aspect }}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          width: `${String(100 / crop.w)}%`,
          height: `${String(100 / crop.h)}%`,
          left: `${String((-crop.x * 100) / crop.w)}%`,
          top: `${String((-crop.y * 100) / crop.h)}%`,
        }}
      />
    </div>
  )
}
