/**
 * What an image element's menu does.
 *
 * Every action reads the element again once its dialog or upload has finished, since the map can be
 * edited while one is open, and commits against the element as it is then. Each change is one edit.
 */

import { describeError } from "@/api/error-copy"
import { announceExport, exportSaveOptions, saveExport } from "@/api/export-file"
import { fetchAssetBlobUrl } from "@/api/asset-blob"
import { isWholeCrop, type ImageCrop } from "@/components/ui/image-editor/geometry"
import { editImage } from "@/components/ui/image-editor/store"
import type { TranslateFn } from "@/i18n/types"
import { bakedImageFileName, bakeImage } from "@/notes/editor/blocks/image-bake"
import { cropsEqual, readCrop } from "@/notes/model/image-crop"
import { toast } from "@/stores/toast"

import { measureImageFile, mindmapImagePath, uploadMindmapImage } from "../assets"
import { detachOps } from "../edit/line-ops"
import type { MindmapEditor } from "../edit/useMindmapEditor"
import type { CanvasImageContent } from "../model/document"
import { op } from "../model/ops"
import type { Scene, SceneElement } from "../model/scene"
import { croppedSize, refitImage } from "./image-fill"
import { IMAGE_SLOT_SIZE } from "./plant"

export interface ImageActionHost {
  readonly editor: MindmapEditor
  /** The scene as it is now, not as it was when the menu opened. */
  readonly scene: () => Scene | null
  readonly t: TranslateFn
}

export type ImageAction = "replace" | "crop" | "copy" | "download" | "remove" | "delete"

/** The crop as it is stored: nothing at all when it keeps the whole picture. */
function storedCrop(crop: ImageCrop): ImageCrop | null {
  return isWholeCrop(crop) ? null : crop
}

function imageOf(host: ImageActionHost, id: string): { element: SceneElement; content: CanvasImageContent } | null {
  const element = host.scene()?.elements.find((candidate) => candidate.id === id)
  return element?.kind === "image" && element.content.$type === "canvasImage"
    ? { element, content: element.content as CanvasImageContent }
    : null
}

function contentWith(assetId: string, crop: ImageCrop | null): CanvasImageContent {
  return crop ? { $type: "canvasImage", assetId, crop } : { $type: "canvasImage", assetId }
}

async function commit(host: ImageActionHost, id: string, content: CanvasImageContent, size: [number, number], label: string) {
  const scene = host.scene()
  const refit = scene ? refitImage(scene, id, content, size) : null
  if (refit) {
    await host.editor.apply(refit.ops, { label: host.t("Mindmap", label) })
  }
}

/** The picture's bytes with its crop applied, which is what leaves the map on a copy or a download. */
async function baked(content: CanvasImageContent): Promise<Blob> {
  const path = mindmapImagePath(content.assetId)
  if (!path) {
    throw new Error("The image has no file.")
  }
  const url = await fetchAssetBlobUrl(path)
  try {
    return await bakeImage(url, readCrop(content.crop))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function runImageAction(host: ImageActionHost, id: string, action: ImageAction): Promise<void> {
  const { t } = host
  const found = imageOf(host, id)
  if (!found) {
    return
  }

  switch (action) {
    case "replace": {
      const picked = await editImage({ title: t("Mindmap", "ImageReplace"), confirm: t("Mindmap", "ImageInsert") })
      if (!picked?.file) {
        return
      }
      try {
        const [asset, fitted] = await Promise.all([uploadMindmapImage(picked.file), measureImageFile(picked.file)])
        const crop = storedCrop(picked.crop)
        await commit(
          host,
          id,
          contentWith(asset.assetId, crop),
          crop ? croppedSize(fitted[0], crop.aspect) : fitted,
          "ImageReplace",
        )
      } catch (error) {
        toast.warning(t("Mindmap", "ImageUploadFailed"), { description: describeError(t, error) })
      }
      return
    }

    case "crop": {
      const path = mindmapImagePath(found.content.assetId)
      if (!path) {
        return
      }
      let url: string
      try {
        url = await fetchAssetBlobUrl(path)
      } catch {
        toast.warning(t("Mindmap", "ImageLoadFailed"))
        return
      }
      const before = readCrop(found.content.crop)
      let picked
      try {
        // The stored window rather than the drawn one, so a second pass reframes the original instead
        // of cropping the crop.
        picked = await editImage({ src: url, crop: before, title: t("Mindmap", "ImageCrop"), confirm: t("Mindmap", "ImageApply") })
      } finally {
        URL.revokeObjectURL(url)
      }
      if (!picked) {
        return
      }
      let assetId = found.content.assetId
      if (picked.file) {
        try {
          assetId = (await uploadMindmapImage(picked.file)).assetId
        } catch (error) {
          toast.warning(t("Mindmap", "ImageUploadFailed"), { description: describeError(t, error) })
          return
        }
      }
      const now = imageOf(host, id)
      if (!now) {
        return
      }
      const next = storedCrop(picked.crop)
      // Confirming without moving anything must not spend an undo step.
      if (assetId === now.content.assetId && cropsEqual(readCrop(now.content.crop), next)) {
        return
      }
      await commit(host, id, contentWith(assetId, next), croppedSize(now.element.width, picked.crop.aspect), "ImageCrop")
      return
    }

    case "copy":
      try {
        const blob = await baked(found.content)
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      } catch {
        toast.warning(t("Mindmap", "ImageCopyFailed"))
      }
      return

    case "download":
      try {
        const blob = await baked(found.content)
        const outcome = await saveExport(blob, {
          ...exportSaveOptions((key) => t("Common", key)),
          fileName: bakedImageFileName("", t("Mindmap", "RadialImage")),
        })
        announceExport(outcome, {
          title: t("Common", "ExportCompleteTitle"),
          downloaded: t("Common", "TransferExportFinished"),
        })
      } catch (error) {
        toast.warning(t("Common", "ExportFailedTitle"), { description: describeError(t, error) })
      }
      return

    case "remove":
      await commit(host, id, contentWith("", null), IMAGE_SLOT_SIZE, "ImageRemove")
      return

    case "delete": {
      const scene = host.scene()
      const detach = scene ? detachOps(scene, new Set([id])) : []
      await host.editor.apply([...detach, op.del([id])], { label: t("Mindmap", "Delete") })
      return
    }
  }
}
