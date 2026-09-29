import { useCallback, useEffect, useRef, type ClipboardEvent, type DragEvent } from "react"

import { describeError } from "@/api/error-copy"
import { useT } from "@/i18n/useT"
import { toast } from "@/stores/toast"

import { IMAGE_ACCEPT, imageFilesOf, measureImageFile, uploadMindmapImage } from "../assets"
import { imageSlotOf, pruneImageSlots, setImageSlot } from "../canvas/image-slots"
import type { CanvasRuntime } from "../canvas/runtime"
import type { MindmapEditor } from "../edit/useMindmapEditor"
import { selectOnly, type Selection } from "../interaction/selection"
import { op } from "../model/ops"
import type { Point, Scene } from "../model/scene"
import { fileFromImageUrl, imageUrlOf, mayCarryImage } from "./dropped-image"
import { isImageSlot, refitImage, slotAt, type Box } from "./image-fill"
import { isTyping } from "./route-guards"

/** The gap between pictures placed together, so a handful of them arrives as a row and not as a pile. */
const IMAGE_STEP = 16

interface ImageFillHost {
  readonly mapId: string
  readonly editor: MindmapEditor
  readonly scene: Scene | null
  readonly selection: Selection
  readonly setSelection: (next: Selection) => void
  readonly runtime: { readonly current: CanvasRuntime | null }
  readonly viewportCentre: () => Point
}

/**
 * Every way a picture reaches the canvas: the picker behind an empty image, a drop, and a paste.
 *
 * A drop or paste aimed at an empty image fills it and places any further files beside it; one aimed
 * anywhere else places new images, as it always has.
 */
export function useImageFill({ mapId, editor, scene, selection, setSelection, runtime, viewportCentre }: ImageFillHost) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  /** The empty image the open picker is for. */
  const pickingFor = useRef<string | null>(null)
  // An upload takes seconds, and the placeholder it lands in is read again from the scene as it is then.
  const latest = useRef(scene)
  useEffect(() => {
    latest.current = scene
  }, [scene])

  // An upload state belongs to an empty image that is still there. Deleted, undone or filled, it goes.
  useEffect(() => {
    if (!scene) {
      return
    }
    const slots = new Set(scene.elements.filter(isImageSlot).map((element) => element.id))
    pruneImageSlots(mapId, (id) => slots.has(id))
  }, [mapId, scene])

  useEffect(() => () => pruneImageSlots(mapId, () => false), [mapId])

  const failed = useCallback(
    (error: unknown) => {
      toast.warning(t("Mindmap", "ErrorTitle"), { description: describeError(t, error) })
    },
    [t],
  )

  /**
   * Puts pictures on the canvas in a row, centred on a point or starting at a left edge.
   *
   * One edit each rather than one batch, so a drop of ten is ten undo steps: each upload can fail on
   * its own, and a batch would have to either hold the finished ones hostage to the last or claim an
   * edit that never happened.
   */
  const placeImages = useCallback(
    async (files: readonly File[], at: Point, from: "centre" | "left" = "centre") => {
      let left: number | null = from === "left" ? at.x : null
      for (const file of files) {
        try {
          const [asset, [width, height]] = await Promise.all([uploadMindmapImage(file), measureImageFile(file)])
          const x = left ?? at.x - width / 2
          const result = await editor.apply(
            [
              op.addElement(
                "image",
                Math.round(x),
                Math.round(at.y - height / 2),
                { $type: "canvasImage", assetId: asset.assetId },
                { ref: "n", wh: [width, height] },
              ),
            ],
            { label: t("Mindmap", "ToolImage") },
          )
          const created = result?.createdIds?.n
          if (created) {
            setSelection(selectOnly("element", created))
          }
          left = x + width + IMAGE_STEP
        } catch (error) {
          // The rest are abandoned: whatever stopped this one is likely to stop the next, and a toast
          // per file is not a report.
          failed(error)
          return
        }
      }
    },
    [editor, failed, setSelection, t],
  )

  /**
   * Fills an empty image with the first file, as one undoable edit that refits the box about its
   * centre, and lines the rest up to its right.
   *
   * The files may still be on their way from a web page, and the placeholder says so meanwhile. A
   * placeholder already uploading ignores the new files. When the fill does not happen (the fetch or
   * upload failed, or the placeholder went away meanwhile) the rest are not placed either.
   */
  const fillWith = useCallback(
    async (id: string, files: () => Promise<readonly File[]>) => {
      if (!isImageSlot(latest.current?.elements.find((element) => element.id === id))) {
        return
      }
      if (imageSlotOf(mapId, id) === "uploading") {
        return
      }
      setImageSlot(mapId, id, "uploading")

      let list: readonly File[]
      try {
        list = await files()
      } catch {
        setImageSlot(mapId, id, "idle")
        toast.warning(t("Mindmap", "ImageDropFromPage"))
        return
      }
      if (list.length === 0) {
        setImageSlot(mapId, id, "idle")
        return
      }

      let box: Box
      try {
        const [asset, size] = await Promise.all([uploadMindmapImage(list[0]), measureImageFile(list[0])])
        const current = latest.current
        const slot = current?.elements.find((element) => element.id === id)
        const refit =
          current && isImageSlot(slot) ? refitImage(current, id, { $type: "canvasImage", assetId: asset.assetId }, size) : null
        setImageSlot(mapId, id, "idle")
        if (!refit) {
          return
        }
        await editor.apply(refit.ops, { label: t("Mindmap", "ToolImage") })
        box = refit.box
      } catch (error) {
        setImageSlot(mapId, id, "failed")
        failed(error)
        return
      }

      if (list.length > 1) {
        await placeImages(list.slice(1), { x: box.x + box.width + IMAGE_STEP, y: box.y + box.height / 2 }, "left")
      }
    },
    [editor, failed, mapId, placeImages, t],
  )

  /** Opens the picker for an empty image. What it brings back is settled when it arrives. */
  const pick = useCallback(
    (id: string) => {
      if (imageSlotOf(mapId, id) === "uploading") {
        return
      }
      pickingFor.current = id
      input.current?.click()
    },
    [mapId],
  )

  const onDragOver = useCallback((event: DragEvent) => {
    // A dragged link that turns out not to be a picture is still refused on drop, with a reason, which
    // beats the webview navigating away to it. A label being typed into keeps its own text drags.
    if (!event.defaultPrevented && !inLabelField(event.target) && mayCarryImage([...event.dataTransfer.types])) {
      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
    }
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (event.defaultPrevented || inLabelField(event.target) || !mayCarryImage([...event.dataTransfer.types])) {
        return
      }
      event.preventDefault()
      const at = runtime.current?.toCanvas(event.clientX, event.clientY) ?? viewportCentre()
      const slot = scene ? slotAt(scene, at) : null
      if (slot && imageSlotOf(mapId, slot.id) === "uploading") {
        return
      }

      // Read now: a drag's data is gone once the drop event returns.
      const dropped = imageFilesOf(event.dataTransfer)
      const url = dropped.length > 0 ? null : imageUrlOf(event.dataTransfer)
      if (dropped.length === 0 && !url) {
        return
      }
      const files = async (): Promise<readonly File[]> =>
        dropped.length > 0 ? dropped : [await fileFromImageUrl(url ?? "", t("Mindmap", "RadialImage"))]

      if (slot) {
        void fillWith(slot.id, files)
        return
      }
      files().then(
        (list) => placeImages(list, at),
        () => toast.warning(t("Mindmap", "ImageDropFromPage")),
      )
    },
    [fillWith, mapId, placeImages, runtime, scene, t, viewportCentre],
  )

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      // Only a picture is taken here. Text on the clipboard belongs to whatever is being typed into,
      // and the map's own copy of a branch never went to the system clipboard at all.
      if (isTyping(event.target)) {
        return
      }
      const files = imageFilesOf(event.clipboardData)
      if (files.length === 0) {
        return
      }
      event.preventDefault()
      const only = selection.elements.size === 1 ? [...selection.elements][0] : null
      const slot = only ? scene?.elements.find((element) => element.id === only) : null
      void (isImageSlot(slot) ? fillWith(slot.id, async () => files) : placeImages(files, viewportCentre()))
    },
    [fillWith, placeImages, scene, selection, viewportCentre],
  )

  const picker = (
    <input
      ref={input}
      type="file"
      accept={IMAGE_ACCEPT}
      multiple
      className="hidden"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        const id = pickingFor.current
        pickingFor.current = null
        // Cleared first, or choosing the same file twice in a row would be no change and no event.
        event.target.value = ""
        if (id && files.length > 0) {
          void fillWith(id, async () => files)
        }
      }}
    />
  )

  return { picker, pick, onDragOver, onDrop, onPaste }
}

/** Inside a field being typed into, including the label editor's own atoms, which are not editable. */
function inLabelField(target: EventTarget | null): boolean {
  return isTyping(target) || (target as Element | null)?.closest?.("[data-mm-editor]") != null
}
