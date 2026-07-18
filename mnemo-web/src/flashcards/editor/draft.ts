import type { CardAssetDto, CardAttachmentDto, CardAttachmentInputDto, CardSide } from "@/api/types"

/**
 * An attachment as the editor holds it. `id` is set for one the card already has and `assetId`
 * for one uploaded during this edit; an existing attachment the host cannot serve has an id but
 * no assetId, which is exactly what lets it survive a round trip it cannot be rendered for.
 *
 * `key` exists because neither id is guaranteed present, and React still needs a stable one.
 */
export interface DraftAttachment {
  key: string
  id: string | null
  assetId: string | null
  side: CardSide
  displayName: string
  sizeBytes: number
  caption: string | null
}

function normalizeSide(side: string): CardSide {
  return side.toLowerCase() === "back" ? "back" : "front"
}

export function draftFromStored(attachment: CardAttachmentDto): DraftAttachment {
  return {
    key: attachment.id,
    id: attachment.id,
    assetId: attachment.assetId,
    side: normalizeSide(attachment.side),
    displayName: attachment.displayName,
    sizeBytes: attachment.sizeBytes,
    caption: attachment.caption,
  }
}

export function draftFromUpload(asset: CardAssetDto, side: CardSide): DraftAttachment {
  return {
    key: asset.assetId,
    // Only the asset id is sent for a new attachment: naming an id the card does not have yet
    // would make the server look for something to carry over and find nothing.
    id: null,
    assetId: asset.assetId,
    side,
    displayName: asset.displayName,
    sizeBytes: asset.sizeBytes,
    caption: null,
  }
}

/**
 * The save payload, front attachments before back ones, matching the order the desktop writes
 * and the order the study shell reads them back in.
 */
export function toAttachmentInputs(attachments: DraftAttachment[]): CardAttachmentInputDto[] {
  const order: CardSide[] = ["front", "back"]
  return order.flatMap((side) =>
    attachments
      .filter((attachment) => attachment.side === side)
      .map((attachment) => ({
        id: attachment.id,
        assetId: attachment.assetId,
        side: attachment.side,
        displayName: attachment.displayName,
        caption: attachment.caption,
      })),
  )
}
