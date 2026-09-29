import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useMindmapImage } from "../assets"
import type { ImageRef } from "../scene/content"
import { useImageSlot } from "./image-slots"

/**
 * A picture, drawn to the box it was given, or the empty slot an image element starts as.
 *
 * `slot` is only ever true for an image element with no file yet. A node that carries a picture and
 * names no file is a broken reference rather than something waiting to be filled, so it keeps the
 * missing box.
 */
export function ImageBody({ id, image, slot }: { id: string; image: ImageRef; slot: boolean }) {
  return slot ? <ImageSlot id={id} /> : <Picture image={image} />
}

/**
 * Stretched rather than fitted, which is what the desktop does: the box arrives at the picture's own
 * proportions, so the only way to distort one is to drag a corner and ask for it.
 *
 * The bytes sit behind the API's token, so they arrive as a blob URL. Nothing is drawn while they are
 * in flight and a placeholder once the answer comes back empty, because an image element drawing
 * nothing at all is indistinguishable from a blank one.
 */
function Picture({ image }: { image: ImageRef }) {
  const t = useT()
  const { url, missing } = useMindmapImage(image.assetId)

  if (url) {
    return (
      <img
        src={url}
        alt={image.caption ?? ""}
        // Or the browser's own image drag would start instead of the gesture the canvas is running.
        draggable={false}
        className="pointer-events-none block h-full w-full rounded-[6px] border border-line-soft object-fill"
      />
    )
  }

  return (
    <span
      className={cn(
        "grid h-full w-full place-items-center overflow-hidden rounded-[6px] px-2",
        "text-center text-[11px] text-ink-3",
        missing ? "border border-dashed border-line bg-frame-hover" : "bg-frame-hover",
      )}
    >
      {missing ? t("Mindmap", "ImageMissing") : null}
    </span>
  )
}

/**
 * The notes image card, drawn the same way: the whole card asks for a file. The controller only
 * answers it on a release that stayed put, so grabbing the card to move it is still a drag.
 */
function ImageSlot({ id }: { id: string }) {
  const t = useT()
  const state = useImageSlot(id)
  const uploading = state === "uploading"

  return (
    <span
      data-mm-chrome={uploading ? undefined : "image"}
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden px-3 text-center",
        "rounded-[8px] border border-dashed border-line bg-canvas-sunken text-ink-3",
        "transition-colors duration-[var(--duration-fast)]",
        uploading ? "mm-image-busy cursor-progress" : "cursor-pointer hover:border-ink-3",
      )}
    >
      <ImageGlyph />
      <span className="text-body-small">
        {t("Mindmap", uploading ? "ImageUploading" : state === "failed" ? "ImageUploadFailed" : "ImagePlaceholder")}
      </span>
    </span>
  )
}

/** The notes card's picture-in-a-frame glyph, path for path. */
function ImageGlyph() {
  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6 shrink-0"
    >
      <path d="M2 3.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
      <path d="M1 12l4.2-4.2a1 1 0 0 1 1.4 0L11 12.2l2.3-2.3a1 1 0 0 1 1.4 0L17 12.2" />
      <path d="M6.5 7.25a.75.75 0 1 0 0-1.5a.75.75 0 0 0 0 1.5Z" />
    </svg>
  )
}
