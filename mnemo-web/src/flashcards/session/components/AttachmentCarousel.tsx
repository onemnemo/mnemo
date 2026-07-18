import { useState } from "react"
import { Dialog } from "radix-ui"

import type { CardAttachmentDto, CardSide } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"

import { useCardAssetUrl } from "../../editor/assets"

/** Attachments belonging to one side, capped as the editor caps them. */
const MAX_PER_SIDE = 3

function forSide(attachments: CardAttachmentDto[], side: CardSide): CardAttachmentDto[] {
  // The DTO carries the side as a free string, so compare the way the editor's draft does.
  return attachments.filter((a) => (a.side.toLowerCase() === "back" ? "back" : "front") === side).slice(0, MAX_PER_SIDE)
}

/**
 * The images on one side of the card, one at a time with wrap-around arrows. Mount it keyed on
 * the card id so a new card starts back at the first image.
 */
export function AttachmentCarousel({ attachments, side }: { attachments: CardAttachmentDto[]; side: CardSide }) {
  const t = useT()
  const [index, setIndex] = useState(0)
  const items = forSide(attachments, side)

  if (items.length === 0) return null

  const current = items[Math.min(index, items.length - 1)]
  const step = (delta: number) => setIndex((i) => (i + delta + items.length) % items.length)

  return (
    <div className="flex w-[230px] shrink-0 flex-col gap-1.5">
      {items.length > 1 && (
        <div className="flex items-center justify-between">
          <NavButton icon="common/chevron-left" label={t("Common", "Back")} onClick={() => step(-1)} />
          <span className="font-mono text-caption tabular-nums text-text-secondary">
            {index + 1} / {items.length}
          </span>
          <NavButton icon="common/chevron-right" label={t("Common", "Next")} onClick={() => step(1)} />
        </div>
      )}

      <Figure attachment={current} />

      {current.caption && <span className="text-center text-caption text-text-tertiary">{current.caption}</span>}
    </div>
  )
}

function NavButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="cursor-pointer rounded-sm px-1 py-0.5 text-text-secondary hover:bg-[var(--button-background-pointer-over)]"
    >
      <AppIcon name={icon} size={14} />
    </button>
  )
}

function Figure({ attachment }: { attachment: CardAttachmentDto }) {
  const url = useCardAssetUrl(attachment.assetId)
  const [open, setOpen] = useState(false)

  if (!url) {
    // Imported from outside the managed images directory, so there is no servable file.
    return (
      <div className="grid h-[120px] place-items-center rounded-md border border-line bg-[var(--widget-background-primary)] p-1.5">
        <AppIcon name="common/image" size={20} className="text-text-faded" />
      </div>
    )
  }

  return (
    <>
      {/* Stops the click from also revealing the answer, which the surface behind this listens for. */}
      <div
        className="cursor-zoom-in rounded-md border border-line bg-[var(--widget-background-primary)] p-1.5"
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <img src={url} alt={attachment.displayName} className="mx-auto max-h-[220px] w-auto object-contain" />
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 p-6 outline-none"
            onClick={() => setOpen(false)}
          >
            <Dialog.Title className="sr-only">{attachment.displayName}</Dialog.Title>
            <img
              src={url}
              alt={attachment.displayName}
              className="max-h-[900px] max-w-[1200px] object-contain"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
