/**
 * Taking a map out of the app.
 *
 * Two of the three formats are made here and one is fetched, and the split is not arbitrary. A
 * picture of a map can only be made where the map was measured, which is the browser: the width of a
 * box is the width its label came out at in this document's fonts, and the server has neither. An
 * outline is a projection of the stored document that never asks how wide anything is, so it is the
 * server's, produced by the exporter the desktop already uses.
 */

import { downloadFromApi, saveBlob } from "@/api/download"

import { canvasMeasurer, FONT_FAMILY, MONO_FAMILY } from "../scene/measure"
import { createColorFlattener } from "./colors"
import { inlineFonts } from "./fonts"
import { rasterize } from "./raster"
import { emitSvg, type SvgPicture } from "./svg"
import type { Scene } from "../model/scene"

export type MapExportFormat = "png" | "svg" | "markdown"

export interface MapExportRequest {
  readonly id: string
  readonly title: string
  /** What to draw. A selection is a scene of its own, projected the same way the whole map is. */
  readonly scene: Scene
  /** Leaves the paper out, for a picture that has to sit on something of its own. */
  readonly transparent?: boolean
}

/** The two families the emitter names, which are the two an embedded picture has to carry. */
const FACES = ["Inter", "Geist Mono"]

export async function exportMap(format: MapExportFormat, request: MapExportRequest): Promise<void> {
  if (format === "markdown") {
    await downloadFromApi(`/mindmaps/${encodeURIComponent(request.id)}/outline`)
    return
  }

  if (format === "svg") {
    const picture = draw(request)
    saveBlob(new Blob([picture.markup], { type: "image/svg+xml;charset=utf-8" }), fileName(request.title, "svg"))
    return
  }

  // Fonts go into the copy that gets rasterised and nowhere else. A saved .svg opened on a machine
  // with Inter on it looks right without them, and carrying a megabyte of font data in a file that
  // does not need it is a worse trade than the fallback.
  const style = await inlineFonts(FACES).catch(() => "")
  saveBlob(await rasterize(draw(request, style)), fileName(request.title, "png"))
}

function draw(request: MapExportRequest, style?: string): SvgPicture {
  const colors = createColorFlattener()
  try {
    const picture = emitSvg(request.scene, {
      color: colors.flatten,
      measure: canvasMeasurer(FONT_FAMILY),
      measureMono: canvasMeasurer(MONO_FAMILY),
      background: request.transparent ? null : "var(--canvas)",
      style,
    })
    if (!picture) {
      throw new Error("There is nothing on this map to export.")
    }
    return picture
  } finally {
    colors.dispose()
  }
}

/**
 * What the file lands under: the title, with anything a file system would refuse taken out. A map
 * called "?" leaves nothing behind, which is why there is a fallback under it.
 */
function fileName(title: string, extension: string): string {
  const name = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "mindmap"
  return `${name}.${extension}`
}
