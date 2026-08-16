import { useState } from "react"
import { Dialog } from "radix-ui"

import type { CardAttachmentDto, CardSide } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useCardAssetUrl } from "../../editor/assets"

/** Attachments belonging to one side, capped as the editor caps them. */
const MAX_PER_SIDE = 3

/** Frame height in px. The image is contained inside it, never cropped, so a run of cards holds steady. */
const FRAME_HEIGHT = 220

function forSide(attachments: CardAttachmentDto[], side: CardSide): CardAttachmentDto[] {
  // The DTO carries the side as a free string, so compare the way the editor's draft does.
  return attachments.filter((a) => (a.side.toLowerCase() === "back" ? "back" : "front") === side).slice(0, MAX_PER_SIDE)
}

/**
 * The images on one side, one at a time in a fixed frame. A side can carry up to three, and
 * stacking them down the card pushes the text off screen and reads the second as a footnote to
 * the first; taking turns in one frame keeps the card's height whatever it holds. With a single
 * image there is no carousel at all - dots under a lone figure are a control that does nothing.
 *
 * Mount it keyed on the card id so a new card starts back at the first image.
 */
export function AttachmentCarousel({ attachments, side }: { attachments: CardAttachmentDto[]; side: CardSide }) {
  const [index, setIndex] = useState(0)
  const items = forSide(attachments, side)

  if (items.length === 0) return null

  const many = items.length > 1
  const current = items[Math.min(index, items.length - 1)]
  const go = (delta: number) => setIndex((i) => (i + delta + items.length) % items.length)

  return (
    <figure className="group/fig w-full max-w-[260px] shrink-0">
      <Frame attachment={current} index={index} total={items.length} many={many} onStep={go} />

      {(many || current.caption) && (
        <figcaption className="mt-2 flex items-center justify-center gap-2">
          {many && (
            <span className="flex items-center gap-1">
              {items.map((item, i) => (
                <button
                  key={`${item.assetId}-${i}`}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={item.displayName}
                  aria-current={i === index}
                  className={cn(
                    "size-1.5 rounded-full transition-colors",
                    i === index ? "bg-ink-2" : "bg-ink-3/35 hover:bg-ink-3",
                  )}
                />
              ))}
            </span>
          )}
          {current.caption && <span className="truncate text-[11.5px] text-ink-3">{current.caption}</span>}
        </figcaption>
      )}
    </figure>
  )
}

function Frame({
  attachment,
  index,
  total,
  many,
  onStep,
}: {
  attachment: CardAttachmentDto
  index: number
  total: number
  many: boolean
  onStep: (delta: number) => void
}) {
  const t = useT()
  const url = useCardAssetUrl(attachment.assetId)
  const [zoomed, setZoomed] = useState(false)

  if (!url) {
    // Imported from outside the managed images directory, so there is no servable file.
    return (
      <div
        className="grid place-items-center overflow-hidden rounded-xl bg-canvas-sunken"
        style={{ height: FRAME_HEIGHT }}
      >
        <AppIcon name="common/image" size={20} className="text-ink-3" />
      </div>
    )
  }

  return (
    <>
      <div
        // Arrow keys page through the images; the session binds digits and Space, never the arrows.
        tabIndex={many ? 0 : undefined}
        onKeyDown={
          many
            ? (event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault()
                  onStep(-1)
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault()
                  onStep(1)
                }
              }
            : undefined
        }
        className="relative flex cursor-zoom-in items-center justify-center overflow-hidden rounded-xl bg-canvas-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        style={{ height: FRAME_HEIGHT }}
        onClick={(event) => {
          // Stops the click from also revealing the answer, which the surface behind this listens for.
          event.stopPropagation()
          setZoomed(true)
        }}
      >
        <img src={url} alt={attachment.displayName} draggable={false} className="max-h-full max-w-full object-contain" />

        {many && (
          <>
            <Arrow side="left" label={t("Common", "Back")} onClick={() => onStep(-1)} />
            <Arrow side="right" label={t("Common", "Next")} onClick={() => onStep(1)} />
            <span className="absolute top-2 right-2 rounded-md bg-ink/55 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-canvas opacity-0 transition-opacity group-hover/fig:opacity-100">
              {index + 1} / {total}
            </span>
          </>
        )}
      </div>

      <Dialog.Root open={zoomed} onOpenChange={setZoomed}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 p-6 outline-none"
            onClick={() => setZoomed(false)}
          >
            <Dialog.Title className="sr-only">{attachment.displayName}</Dialog.Title>
            <img src={url} alt={attachment.displayName} className="max-h-[900px] max-w-[1200px] object-contain" />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

function Arrow({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        "absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full",
        "bg-canvas/85 text-ink-2 shadow-canvas backdrop-blur-[2px]",
        "opacity-0 transition-opacity hover:text-ink group-hover/fig:opacity-100 focus-visible:opacity-100",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <AppIcon name={side === "left" ? "common/chevron-left" : "common/chevron-right"} size={16} strokeWidth={2} />
    </button>
  )
}
